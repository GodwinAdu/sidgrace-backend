import axios, { AxiosError } from "axios";
import config from "../config/config";
import { log } from "../utils/logger";

/**
 * SMS gateway: SMSOnlineGH (https://dev.smsonlinegh.com/docs/v5/http/rest)
 *
 *  - POST {baseUrl}/message/sms/send  with header  Authorization: key <API_KEY>
 *  - A request only succeeded when HTTP status is 200 AND handshake.id === 0 (HSHK_OK).
 *  - Each destination then gets its own status (e.g. 2105 DS_PENDING_ENROUTE).
 */

interface SmsProviderValues {
    destination: string;
    message: string;
}

export interface SmsProviderResult {
    success: boolean;
    message: string;
    /** Batch id returned by the gateway (useful when talking to SMSOnlineGH support). */
    batch?: string;
    /** Normalised number the message was sent to. */
    to?: string;
    /** Per-destination status label from the gateway, e.g. DS_PENDING_ENROUTE. */
    status?: string;
    /**
     * Only meaningful when success is false.
     *  true  = temporary / account-level problem (no internet, gateway down, auth or credit
     *          issue): the same message may succeed later, so queue it for another attempt.
     *  false = this message itself is bad (invalid number, empty text, number rejected):
     *          retrying will never help.
     */
    retryable?: boolean;
}

interface GatewayHandshake { id: number; label: string }
interface GatewayDestination { id: string; to: string; status?: { id: number; label: string } }
interface GatewayResponse<T> { handshake?: GatewayHandshake; data?: T }
interface SendData { batch?: string; destinations?: GatewayDestination[] }
interface BalanceData { balance: number; model: string; currencyName: string | null; currencyCode: string | null }

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Normalises a phone number to the international format the gateway expects
 * (digits only, no "+"). Ghana local numbers are converted to 233XXXXXXXXX:
 *   "024 123 4567" -> "233241234567",  "+233 24-123-4567" -> "233241234567",
 *   "241234567"    -> "233241234567",  "00233241234567"   -> "233241234567".
 * Other international numbers (10-15 digits, not starting with 0) pass through.
 * Returns null when the number cannot be valid.
 */
export function normalizePhone(raw: string): string | null {
    if (!raw) return null;
    let digits = String(raw).replace(/[^\d]/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);           // 00233... -> 233...
    if (digits.startsWith("2330")) digits = "233" + digits.slice(4); // 2330241234567 (common typo)
    if (digits.length === 10 && digits.startsWith("0")) return "233" + digits.slice(1);
    if (digits.length === 9 && !digits.startsWith("0")) return "233" + digits;
    if (digits.startsWith("233")) return digits.length === 12 ? digits : null;
    if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0")) return digits;
    return null;
}

/**
 * Message type 0 is the GSM default alphabet. Replace common "smart" characters
 * (curly quotes, long dashes, ellipsis, non-breaking spaces) that phones and word
 * processors insert, so they don't arrive as "?" on the recipient's phone.
 */
function toGsmFriendly(text: string): string {
    return text
        .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
        .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
        .replace(/[\u2013\u2014\u2212]/g, "-")
        .replace(/\u2026/g, "...")
        .replace(/[\u00A0\u2007\u202F]/g, " ")
        .trim();
}

function gatewayHeaders() {
    return {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `key ${config.smsonline.apiKey}`,
    };
}

/** Explains a failed request without leaking the API key into logs. */
function describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const e = error as AxiosError<GatewayResponse<unknown>>;
        const hs = e.response?.data?.handshake;
        if (hs) return `${hs.label} (handshake ${hs.id}, HTTP ${e.response?.status})`;
        if (e.response) return `HTTP ${e.response.status} ${e.response.statusText}`;
        if (e.code === "ECONNABORTED") return "Gateway timed out";
        return `Network error: ${e.code || e.message} (is the internet connected?)`;
    }
    return String((error as Error)?.message || error);
}

/** Returns a human-readable reason when the gateway is not configured, otherwise null. */
export function smsConfigProblem(): string | null {
    return isConfigured();
}

function isConfigured(): string | null {
    if (!config.smsonline.apiKey) return "SMS gateway not configured (SMSONLINEGH_API_KEY is missing)";
    if (!config.smsonline.senderId) return "SMS gateway not configured (SMSONLINEGH_SENDER_ID is missing)";
    if (config.smsonline.senderId.length > 11) return "SMSONLINEGH_SENDER_ID must be at most 11 characters";
    return null;
}

/**
 * Sends a single SMS through SMSOnlineGH.
 * Never throws: always resolves to { success, message, ... } so callers (the HTTP
 * route and the message queue job) can record the outcome and retry later.
 */
export async function smsProvider(values: SmsProviderValues): Promise<SmsProviderResult> {
    const notConfigured = isConfigured();
    if (notConfigured) {
        log.error(notConfigured);
        return { success: false, message: notConfigured, retryable: true };
    }

    const to = normalizePhone(values.destination);
    if (!to) return { success: false, message: `Invalid phone number: "${values.destination ?? ""}"`, retryable: false };

    const text = toGsmFriendly(values.message || "");
    if (!text) return { success: false, message: "Message text is empty", retryable: false };

    try {
        const response = await axios.post<GatewayResponse<SendData>>(
            `${config.smsonline.baseUrl}/message/sms/send`,
            { text, type: 0, sender: config.smsonline.senderId, destinations: [to] },
            { headers: gatewayHeaders(), timeout: REQUEST_TIMEOUT_MS }
        );

        const hs = response.data?.handshake;
        if (!hs || hs.id !== 0) {
            const reason = hs ? `${hs.label} (handshake ${hs.id})` : "Unexpected gateway response";
            log.error(`SMS to ${to} rejected: ${reason}`);
            // Handshake errors are account-level (auth, inactive account, credit, sender name):
            // fixing the account makes the same message sendable, so keep it queued.
            return { success: false, message: reason, to, retryable: true };
        }

        const dest = response.data.data?.destinations?.find((d) => d.to === to) ?? response.data.data?.destinations?.[0];
        const status = dest?.status?.label;
        // DS_REJECTED* / DS_*FAILED* style labels mean the gateway accepted the request but
        // refused this number (e.g. invalid or unsupported network).
        if (status && /REJECT|FAIL|INVALID|UNDELIV/i.test(status)) {
            log.error(`SMS to ${to} not accepted for delivery: ${status}`);
            return { success: false, message: status, to, status, batch: response.data.data?.batch, retryable: false };
        }

        log.info(`SMS to ${to} accepted (${status || "submitted"}), batch ${response.data.data?.batch}`);
        return { success: true, message: "SMS submitted", to, status, batch: response.data.data?.batch };
    } catch (error) {
        const reason = describeError(error);
        log.error(`Error sending SMS to ${to}: ${reason}`);
        // Network errors, timeouts, 5xx and 401/403 can all clear up later.
        const httpStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable = !httpStatus || httpStatus >= 500 || httpStatus === 401 || httpStatus === 403 || httpStatus === 429;
        return { success: false, message: reason, to, retryable };
    }
}

/** Returns the account's remaining SMS credit. */
export async function smsBalance(): Promise<{ success: boolean; message: string; data?: BalanceData }> {
    if (!config.smsonline.apiKey) return { success: false, message: "SMS gateway not configured (SMSONLINEGH_API_KEY is missing)" };
    try {
        const response = await axios.post<GatewayResponse<BalanceData>>(
            `${config.smsonline.baseUrl}/account/balance`,
            undefined,
            { headers: gatewayHeaders(), timeout: REQUEST_TIMEOUT_MS }
        );
        const hs = response.data?.handshake;
        if (!hs || hs.id !== 0) return { success: false, message: hs ? `${hs.label} (handshake ${hs.id})` : "Unexpected gateway response" };
        return { success: true, message: "OK", data: response.data.data };
    } catch (error) {
        const reason = describeError(error);
        log.error(`Error checking SMS balance: ${reason}`);
        return { success: false, message: reason };
    }
}

/**
 * ESC/POS receipt builder + raw network sender for the clinic's Xprinter XP-E200L.
 *
 * Kept byte-for-byte identical to the app's lib/clinical/escpos-receipt.ts (the
 * sequence verified on the physical printer), so a receipt printed through the relay
 * looks exactly like one printed by the local app.
 */
import net from "node:net";

export interface EscPosLine { name: string; amount: string; detail?: string }

export interface EscPosReceiptData {
    clinicName: string;
    clinicAddress?: string;
    clinicPhone?: string;
    title?: string;
    docNumber?: string;
    dateText?: string;
    customerName?: string;
    customerId?: string;
    cashierName?: string;
    lines: EscPosLine[];
    totals: { label: string; value: string; bold?: boolean }[];
    footer?: string;
    width?: number;
    openDrawer?: boolean;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function justify(label: string, value: string, width: number): string {
    const w = Math.max(16, width);
    const v = value.length > w ? value.slice(0, w) : value;
    let l = label;
    const room = w - v.length - 1;
    if (l.length > room) l = l.slice(0, Math.max(0, room));
    const gap = Math.max(1, w - l.length - v.length);
    return l + " ".repeat(gap) + v;
}

const rule = (width: number) => "-".repeat(Math.max(16, width));

export function buildReceiptBytes(data: EscPosReceiptData): Uint8Array {
    const width = data.width && data.width >= 24 ? data.width : 48;
    const out: number[] = [];
    const text = (s: string) => {
        for (const ch of s) {
            const code = ch.charCodeAt(0);
            out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
        }
    };
    const line = (s = "") => { text(s); out.push(LF); };

    out.push(ESC, 0x40);
    out.push(ESC, 0x74, 0x00);

    out.push(ESC, 0x61, 0x01);
    out.push(ESC, 0x21, 0x30);
    line(data.clinicName);
    out.push(ESC, 0x21, 0x00);
    if (data.clinicAddress) line(data.clinicAddress);
    if (data.clinicPhone) line(`Tel: ${data.clinicPhone}`);
    if (data.title) {
        out.push(ESC, 0x45, 0x01);
        line(data.title);
        out.push(ESC, 0x45, 0x00);
    }

    out.push(ESC, 0x61, 0x00);
    line(rule(width));
    if (data.docNumber) line(justify("No:", data.docNumber, width));
    if (data.dateText) line(justify("Date:", data.dateText, width));
    if (data.customerName) line(justify("Customer:", data.customerName, width));
    if (data.customerId) line(justify("ID:", data.customerId, width));
    if (data.cashierName) line(justify("Cashier:", data.cashierName, width));
    line(rule(width));

    for (const it of data.lines) {
        line(it.name);
        line(justify(it.detail ?? "", it.amount, width));
    }
    line(rule(width));

    for (const row of data.totals) {
        if (row.bold) out.push(ESC, 0x45, 0x01);
        line(justify(row.label, row.value, width));
        if (row.bold) out.push(ESC, 0x45, 0x00);
    }
    line(rule(width));

    if (data.footer) {
        out.push(ESC, 0x61, 0x01);
        line(data.footer);
        out.push(ESC, 0x61, 0x00);
    }

    out.push(LF, LF, LF);
    out.push(GS, 0x56, 0x42, 0x00);
    if (data.openDrawer) out.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return Uint8Array.from(out);
}

export interface PrintResult { ok: boolean; bytes?: number; error?: string }

/** Write raw bytes to host:port. Never throws. */
export function sendToPrinter(host: string, port: number, bytes: Uint8Array, timeoutMs = 8000): Promise<PrintResult> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const done = (r: PrintResult) => {
            if (settled) return;
            settled = true;
            try { socket.destroy(); } catch { /* ignore */ }
            resolve(r);
        };
        socket.setTimeout(timeoutMs);
        socket.once("timeout", () => done({ ok: false, error: "Printer connection timed out" }));
        socket.once("error", (e: Error) => done({ ok: false, error: e.message }));
        socket.connect(port, host, () => {
            socket.write(Buffer.from(bytes), (err) => {
                if (err) return done({ ok: false, error: err.message });
                setTimeout(() => done({ ok: true, bytes: bytes.length }), 300);
            });
        });
    });
}

/** Quick reachability check (connect only, nothing printed). */
export function probePrinter(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const finish = (ok: boolean) => { try { socket.destroy(); } catch { /* ignore */ } resolve(ok); };
        socket.setTimeout(timeoutMs);
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(port, host, () => finish(true));
    });
}

// ---------------------------------------------------------------------------------
// Input validation: the relay is reachable on the LAN, so never trust the payload.
// ---------------------------------------------------------------------------------

const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim() ? v.slice(0, max) : undefined;

/** Returns a clean receipt object, or an error message. */
export function sanitizeReceipt(input: unknown): { data?: EscPosReceiptData; error?: string } {
    if (!input || typeof input !== "object") return { error: "Body must be a JSON object" };
    const b = input as Record<string, unknown>;
    const clinicName = str(b.clinicName, 64);
    if (!clinicName) return { error: "clinicName is required" };
    if (!Array.isArray(b.lines)) return { error: "lines must be an array" };
    if (b.lines.length > 200) return { error: "Too many lines (max 200)" };
    const totals = Array.isArray(b.totals) ? b.totals : [];
    if (totals.length > 30) return { error: "Too many totals (max 30)" };

    const lines: EscPosLine[] = b.lines.map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return { name: str(o.name, 120) ?? "", amount: str(o.amount, 24) ?? "", detail: str(o.detail, 60) };
    });
    const cleanTotals = totals.map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        return { label: str(o.label, 40) ?? "", value: str(o.value, 24) ?? "", bold: o.bold === true };
    });
    const width = typeof b.width === "number" && b.width >= 24 && b.width <= 64 ? Math.floor(b.width) : 48;

    return {
        data: {
            clinicName,
            clinicAddress: str(b.clinicAddress, 120),
            clinicPhone: str(b.clinicPhone, 40),
            title: str(b.title, 40),
            docNumber: str(b.docNumber, 40),
            dateText: str(b.dateText, 40),
            customerName: str(b.customerName, 80),
            customerId: str(b.customerId, 40),
            cashierName: str(b.cashierName, 80),
            lines,
            totals: cleanTotals,
            footer: str(b.footer, 200),
            width,
            openDrawer: b.openDrawer === true,
        },
    };
}

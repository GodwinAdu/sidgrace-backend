import { smsBalance, smsConfigProblem } from "../actions/sms.actions";
import { queueDueNotifications, sendDirectSms, sendPendingSmsMessages } from "../actions/message.actions";
import config from "../config/config";
import { log } from "../utils/logger"
import { Request, Response } from "express";

const MAX_MESSAGE_LENGTH = 918; // 6 concatenated GSM parts; longer texts are almost always a mistake

/**
 * POST /api/v1/sms/send-sms
 * Body: { destination: string, message: string, recipientName?: string, source?: string }
 *
 * 200 { success: true,  ... }                 sent to the gateway
 * 202 { success: false, queued: true, ... }   temporary problem; will be retried automatically
 * 422 { success: false, queued: false, ... }  permanent problem (e.g. invalid number)
 */
export async function sendSms(req: Request, res: Response) {
    try {
        const { destination, message, recipientName, source } = req.body ?? {};
        if (typeof destination !== "string" || typeof message !== "string" || !destination.trim() || !message.trim()) {
            return res.status(400).json({ success: false, message: "destination and message are required" });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({ success: false, message: `message is too long (max ${MAX_MESSAGE_LENGTH} characters)` });
        }

        const result = await sendDirectSms({
            destination,
            message,
            recipientName: typeof recipientName === "string" ? recipientName.slice(0, 200) : undefined,
            source: typeof source === "string" ? source.slice(0, 50) : undefined,
        });
        const status = result.success ? 200 : result.queued ? 202 : 422;
        return res.status(status).json(result);
    } catch (error) {
        log.error("Error in send sms: " + String(error));
        return res.status(500).json({ success: false, message: "Failed to send SMS" });
    }
}

/**
 * POST /api/v1/sms/queue/run
 * Processes the queue now (the app calls this right after a Messaging-page send) instead
 * of waiting for the next minute tick. Responds immediately; work continues in background.
 */
export async function runSmsQueue(req: Request, res: Response) {
    res.status(202).json({ success: true, message: "Queue run started" });
    queueDueNotifications()
        .then(() => sendPendingSmsMessages())
        .catch((error) => log.error("Manual queue run failed: " + String(error)));
}

/**
 * GET /api/v1/sms/balance
 * Response: { success, message, configured, senderId, data?: { balance, model, currencyName, currencyCode } }
 */
export async function getSmsBalance(req: Request, res: Response) {
    try {
        const problem = smsConfigProblem();
        const result = await smsBalance();
        return res.status(result.success ? 200 : 502).json({
            ...result,
            configured: !problem,
            senderId: config.smsonline.senderId || null,
            ...(problem ? { message: problem } : {}),
        });
    } catch (error) {
        log.error("Error in sms balance: " + String(error));
        return res.status(500).json({ success: false, message: "Failed to check SMS balance" });
    }
}

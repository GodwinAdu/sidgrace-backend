import { Types } from "mongoose";
import Message, { MessageDoc } from "../models/message.models";
import Notification from "../models/notification.models";
import { Patient } from "../models/patient.models";
import { smsConfigProblem, smsProvider, SmsProviderResult } from "./sms.actions";
import { log } from "../utils/logger";

/**
 * SMS queue
 * =========
 * 1. queueDueNotifications()  - turns due "published" Notifications (Messaging page:
 *    individual or bulk, immediate or scheduled) into one pending Message per patient.
 * 2. sendPendingSmsMessages() - sends pending Messages through the gateway, with retries.
 * 3. sendDirectSms()          - one-off SMS from the app (welcome, appointment, recall);
 *    sent right away, and queued for retry if the failure is temporary.
 *
 * Every SMS ends up as a Message document, which is the SMS history shown in the app.
 */

const PROVIDER = "smsonlinegh";
/** Recipients turned into messages per notification per run. */
const QUEUE_BATCH = 100;
/** Messages sent per run (one run per minute). */
const SEND_BATCH = 50;
/** Wait before each retry of a temporary failure: 1 min, 5 min, 15 min, 1 h, 3 h. */
const RETRY_DELAYS_MIN = [1, 5, 15, 60, 180];
/** Pending messages older than this are not sent any more (a 2-day-old confirmation is noise). */
const MAX_AGE_HOURS = 24;
/** Patients in these states never receive messages. */
const NEVER_MESSAGE = ["deceased"];
/** Extra exclusions for bulk sends ("all active patients"). */
const BULK_EXCLUDE = ["deceased", "archived", "inactive"];

let queueRunning = false;
let sendRunning = false;
let lastConfigWarning = 0;

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);

/** Records a gateway result on a message document (does not save). */
function applyResult(msg: MessageDoc, result: SmsProviderResult) {
    msg.provider = PROVIDER;
    if (result.to) msg.normalizedPhone = result.to;
    if (result.batch) msg.batch = result.batch;
    if (result.status) msg.gatewayStatus = result.status;

    if (result.success) {
        msg.status = "sent";
        msg.sentAt = new Date();
        msg.lastError = undefined;
        msg.nextAttemptAt = undefined;
        return;
    }

    msg.lastError = result.message;
    if (!result.retryable) {
        msg.status = "failed";
        msg.nextAttemptAt = undefined;
        return;
    }

    msg.retryCount = (msg.retryCount || 0) + 1;
    const delay = RETRY_DELAYS_MIN[msg.retryCount - 1];
    if (delay === undefined) {
        msg.status = "cancelled";
        msg.lastError = `Gave up after ${msg.retryCount} attempts: ${result.message}`;
        msg.nextAttemptAt = undefined;
    } else {
        msg.status = "pending";
        msg.nextAttemptAt = minutesFromNow(delay);
    }
}

// ---------------------------------------------------------------------------------------
// 1. Notifications -> messages
// ---------------------------------------------------------------------------------------

/**
 * Queues messages for every due notification (oldest first, QUEUE_BATCH recipients each).
 * Due = published, not completed, and either not scheduled or scheduledDate has passed.
 * Idempotent: a unique index on (notificationId, recipientId) prevents duplicate messages
 * even if the process stops between inserting messages and updating the notification.
 */
export async function queueDueNotifications() {
    if (queueRunning) return { success: true, message: "Previous run still in progress" };
    queueRunning = true;
    try {
        const now = new Date();
        const due = await Notification.find({
            type: "SMS",
            sendMode: { $in: ["individual", "bulk"] },
            status: "published",
            completed: { $ne: true },
            "recipients.0": { $exists: true },
            $or: [{ isScheduled: { $ne: true } }, { scheduledDate: { $lte: now } }],
        }).sort({ createdAt: 1 }).limit(10);

        let queued = 0, skipped = 0;
        for (const notification of due) {
            const batch = notification.recipients.slice(0, QUEUE_BATCH) as unknown as Types.ObjectId[];
            const exclude = notification.sendMode === "bulk" ? BULK_EXCLUDE : NEVER_MESSAGE;

            const patients = await Patient.find({ _id: { $in: batch } })
                .select("fullName phone status")
                .lean<{ _id: Types.ObjectId; fullName?: string; phone?: string; status?: string }[]>();

            const docs = [];
            for (const p of patients) {
                if (p.status && exclude.includes(p.status)) { skipped++; continue; }
                const hasPhone = !!p.phone && p.phone.replace(/\D/g, "").length >= 9;
                docs.push({
                    type: "SMS",
                    notificationId: notification._id,
                    recipientId: p._id,
                    recipientName: p.fullName,
                    recipientPhone: p.phone,
                    source: "notification",
                    message: notification.message,
                    status: hasPhone ? "pending" : "failed",
                    lastError: hasPhone ? undefined : "No phone number on file",
                    nextAttemptAt: hasPhone ? now : undefined,
                    createdBy: notification.createdBy ? String(notification.createdBy) : "System",
                });
            }
            // Patients that no longer exist (deleted) are simply dropped.
            skipped += batch.length - patients.length;

            if (docs.length) {
                try {
                    const res = await Message.insertMany(docs, { ordered: false });
                    queued += res.length;
                } catch (err: any) {
                    // E11000 = already queued in an earlier, interrupted run: fine.
                    const inserted = err?.insertedDocs?.length ?? err?.result?.insertedCount ?? 0;
                    queued += inserted;
                    const nonDuplicate = (err?.writeErrors ?? []).filter((e: any) => (e?.code ?? e?.err?.code) !== 11000);
                    if (!err?.writeErrors || nonDuplicate.length) throw err;
                }
            }

            const updated = await Notification.findOneAndUpdate(
                { _id: notification._id },
                { $pullAll: { recipients: batch } },
                { new: true }
            );
            if (updated && updated.recipients.length === 0) {
                updated.completed = true;
                await updated.save();
            }
        }

        if (queued || skipped) log.info(`SMS queue: ${queued} message(s) queued, ${skipped} recipient(s) skipped`);
        return { success: true, message: `${queued} queued, ${skipped} skipped` };
    } catch (error) {
        log.error("queueDueNotifications failed: " + String(error));
        return { success: false, message: "Failed to queue notifications", error: String(error) };
    } finally {
        queueRunning = false;
    }
}

// ---------------------------------------------------------------------------------------
// 2. Send queued messages
// ---------------------------------------------------------------------------------------

export async function sendPendingSmsMessages() {
    if (sendRunning) return;
    sendRunning = true;
    try {
        const problem = smsConfigProblem();
        if (problem) {
            // Keep messages queued (they are sent once the key is added); warn hourly, not every minute.
            if (Date.now() - lastConfigWarning > 60 * 60_000) {
                const waiting = await Message.countDocuments({ type: "SMS", status: "pending" });
                log.error(`${problem}. ${waiting} SMS waiting in the queue.`);
                lastConfigWarning = Date.now();
            }
            return;
        }

        // Expire stale messages instead of sending them days late.
        const expired = await Message.updateMany(
            { type: "SMS", status: "pending", createdAt: { $lt: new Date(Date.now() - MAX_AGE_HOURS * 3_600_000) } },
            { $set: { status: "cancelled", lastError: `Expired: not sent within ${MAX_AGE_HOURS} hours` }, $unset: { nextAttemptAt: 1 } }
        );
        if (expired.modifiedCount) log.error(`SMS queue: ${expired.modifiedCount} message(s) expired`);

        const now = new Date();
        const pending = await Message.find({
            type: "SMS",
            status: "pending",
            $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
        }).sort({ createdAt: 1 }).limit(SEND_BATCH);
        if (!pending.length) return;

        let sent = 0, failed = 0, retrying = 0, cancelled = 0;
        for (const msg of pending) {
            const result = await smsProvider({ destination: msg.recipientPhone ?? "", message: msg.message ?? "" });
            applyResult(msg, result);
            await msg.save();
            if (msg.status === "sent") sent++;
            else if (msg.status === "failed") failed++;
            else if (msg.status === "cancelled") cancelled++;
            else retrying++;

            // An account-level error (bad key, no credit) will hit every message the same way:
            // stop this run instead of burning a retry on each of the remaining messages.
            if (!result.success && result.retryable) break;
        }
        log.info(`SMS queue run: sent ${sent}, failed ${failed}, retrying ${retrying}, cancelled ${cancelled}`);
    } catch (error) {
        log.error("sendPendingSmsMessages failed: " + String(error));
    } finally {
        sendRunning = false;
    }
}

// ---------------------------------------------------------------------------------------
// 3. Direct (one-off) SMS from the app
// ---------------------------------------------------------------------------------------

interface DirectSmsInput {
    destination: string;
    message: string;
    recipientName?: string;
    source?: string;
}

/**
 * Sends one SMS now and records it. If the failure is temporary (no internet, gateway
 * down, key not set yet) the message stays queued and the queue retries it.
 */
export async function sendDirectSms(input: DirectSmsInput) {
    const msg = new Message({
        type: "SMS",
        recipientName: input.recipientName,
        recipientPhone: input.destination,
        source: input.source || "direct",
        message: input.message,
        status: "pending",
        createdBy: "App",
    }) as unknown as MessageDoc & { save(): Promise<unknown> };

    const result = await smsProvider({ destination: input.destination, message: input.message });
    applyResult(msg, result);
    try {
        await msg.save();
    } catch (error) {
        log.error("Could not record SMS in history: " + String(error));
    }

    return {
        ...result,
        messageId: String(msg._id),
        queued: msg.status === "pending",
    };
}

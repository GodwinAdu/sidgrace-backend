import { model, models, Schema, Types } from "mongoose";

/**
 * One outgoing message to one recipient (the SMS outbox / history).
 *
 * Lifecycle:  pending --(sent ok)--> sent
 *             pending --(permanent error, e.g. invalid number)--> failed
 *             pending --(temporary error x MAX_ATTEMPTS)--> cancelled
 *
 * The frontend has a matching schema in lib/models/message.models.ts - keep them in sync.
 */
export const MESSAGE_STATUSES = ["pending", "sent", "failed", "cancelled"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface MessageDoc {
    _id: Types.ObjectId;
    type: "EMAIL" | "SMS";
    recipientName?: string;
    recipientPhone?: string;
    recipientEmail?: string;
    recipientId?: Types.ObjectId;
    notificationId?: Types.ObjectId;
    /** Where the message came from: "notification", "staff-welcome", "patient-welcome", "appointment", "recall", ... */
    source?: string;
    subject?: string;
    message?: string;
    retryCount: number;
    status: MessageStatus;
    /** Earliest time the queue may (re)try sending this message. */
    nextAttemptAt?: Date;
    sentAt?: Date;
    /** Gateway bookkeeping, useful when following up with SMSOnlineGH support. */
    provider?: string;
    batch?: string;
    gatewayStatus?: string;
    normalizedPhone?: string;
    lastError?: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<MessageDoc>({
    type: { type: String, enum: ["EMAIL", "SMS"] },
    recipientName: { type: String },
    recipientPhone: { type: String },
    recipientEmail: { type: String },
    recipientId: { type: Schema.Types.ObjectId },
    notificationId: { type: Schema.Types.ObjectId, ref: "Notification" },
    source: { type: String },
    subject: { type: String },
    message: { type: String },
    retryCount: { type: Number, default: 0 },
    status: { type: String, enum: MESSAGE_STATUSES, default: "pending" },
    nextAttemptAt: { type: Date },
    sentAt: { type: Date },
    provider: { type: String },
    batch: { type: String },
    gatewayStatus: { type: String },
    normalizedPhone: { type: String },
    lastError: { type: String },
    createdBy: { type: String, default: "System" }
}, { timestamps: true });

// The queue polls by these fields every minute; history lists newest first.
MessageSchema.index({ status: 1, type: 1, nextAttemptAt: 1 });
MessageSchema.index({ createdAt: -1 });
// One message per patient per notification: makes queueing safe to repeat after a crash.
MessageSchema.index(
    { notificationId: 1, recipientId: 1 },
    { unique: true, partialFilterExpression: { notificationId: { $exists: true }, recipientId: { $exists: true } } }
);

const Message = models.Message ?? model<MessageDoc>("Message", MessageSchema);

export default Message;

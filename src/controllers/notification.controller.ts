import Notification from "../models/notification.models"
import { log } from "../utils/logger"
import { Request, Response } from "express";

export async function checkNotificationPending(_req: Request, res: Response) {
    try {
        const now = new Date();

        // Find all pending notifications whose scheduledDate is now or earlier
        const pendingNotifications = await Notification.find({
            status: "pending",
            scheduledDate: { $lte: now },
        });

        if (pendingNotifications.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No pending notifications to publish",
                data: [],
            });
        }

        // Extract IDs
        const idsToUpdate = pendingNotifications.map(n => n._id);

        // Update them to 'published'
        await Notification.updateMany(
            { _id: { $in: idsToUpdate } },
            { $set: { status: "published" } }
        );

        // Optionally, return updated notifications
        const updatedNotifications = await Notification.find({ _id: { $in: idsToUpdate } });

        res.status(200).json({
            success: true,
            message: `${updatedNotifications.length} notification(s) published`,
            data: updatedNotifications,
        });

    } catch (error) {
        console.error("Error in checkNotificationPending:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while processing pending notifications",
            error: String(error),
        });
    }
}

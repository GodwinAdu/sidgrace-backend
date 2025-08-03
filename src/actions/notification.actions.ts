import Notification from "../models/notification.models";


export async function checkNotificationPending() {
    try {
        const now = new Date();

        // Find all pending notifications that are due to be published
        const pendingNotifications = await Notification.find({
            status: "pending",
            scheduledDate: { $lte: now },
        });

        if (pendingNotifications.length === 0) {
            return {
                success: true,
                message: "No pending notifications to publish",
                data: [],
            };
        }

        // Extract notification IDs to update
        const idsToUpdate = pendingNotifications.map((n) => n._id);

        // Update their status to "published"
        await Notification.updateMany(
            { _id: { $in: idsToUpdate } },
            { $set: { status: "published" } }
        );

        // Optionally return the updated documents
        const updatedNotifications = await Notification.find({
            _id: { $in: idsToUpdate },
        });

        console.log("completed in here")

        return {
            success: true,
            message: `${updatedNotifications.length} notification(s) published`,
            data: updatedNotifications,
        };
    } catch (error) {
        console.error("Error in checkNotificationPending:", error);

        return {
            success: false,
            message: "Failed to process pending notifications",
            error: String(error),
        };
    }
}

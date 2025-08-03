import mongoose from "mongoose";
import Message from "../models/message.models";
import Notification from "../models/notification.models";
import { Patient } from "../models/patient.models";
import { smsProvider } from "./sms.actions";


export async function processIndividualMessages() {
    try {
        const notification = await Notification.findOne({
            sendMode: "individual",
            status: "published",
            recipients: { $exists: true, $not: { $size: 0 } },
        });

        if (!notification) {
            return {
                success: true,
                message: "No published individual notifications with recipients",
            };
        }

        // Limit to 50 recipients
        const recipientsToProcess = notification.recipients.slice(0, 50);

        // Fetch patient info in bulk
        const patients = await Patient.find({ _id: { $in: recipientsToProcess } });

        // Map and create messages
        const messageDocs = patients.map((patient) => ({
            type: notification.type,
            recipientName: patient.fullName,
            recipientPhone: patient.phone,
            subject: notification.subject,
            message: notification.message,
            status: "pending",
            createdBy: "System", // or use notification.createdBy if needed
        }));

        // Insert messages in bulk
        await Message.insertMany(messageDocs);

        // Remove processed IDs from notification.recipients
        notification.recipients = notification.recipients.filter(
            (id) => !recipientsToProcess.includes(id)
        );

        // ✅ Mark as completed if no recipients left
        if (notification.recipients.length === 0) {
            notification.completed = true;
        }


        // Save the updated notification
        await notification.save();

        return {
            success: true,
            createdCount: messageDocs.length,
        };
    } catch (error) {
        console.error("Error in processIndividualMessages:", error);
        return {
            success: false,
            message: "Failed to process individual messages",
            error: String(error),
        };
    }
}




export async function sendPendingSmsMessages() {
    try {
        const pendingMessages = await Message.find({
            status: "pending",
            type: "SMS",
            retryCount: { $lt: 5 }, // only retry messages fewer than 5 times
        }).limit(50);

        if (pendingMessages.length === 0) {
            console.log("No pending SMS messages to send.");
            return;
        }

        let sentCount = 0;
        let retryCount = 0;
        let cancelledCount = 0;

        for (const msg of pendingMessages) {
            try {
                const values = {
                    destination: msg.recipientPhone,
                    message: msg.message,
                };

                const sent = await smsProvider(values);

                console.log("testing sms sent status",sent)

                if (sent.success) {
                    msg.status = "sent";
                    msg.retryCount = 0; // reset on success
                    sentCount++;
                } else {
                    msg.retryCount = (msg.retryCount || 0) + 1;
                    retryCount++;

                    if (msg.retryCount >= 5) {
                        msg.status = "cancelled";
                        cancelledCount++;
                    }
                }

                await msg.save();
            } catch (err) {
                console.error(`❌ Error sending SMS to ${msg.recipientPhone}:`, err);
                msg.retryCount = (msg.retryCount || 0) + 1;
                retryCount++;

                if (msg.retryCount >= 5) {
                    msg.status = "cancelled";
                    cancelledCount++;
                }

                await msg.save();
            }
        }

        console.log(`✅ SMS Job Summary: Sent: ${sentCount}, Retrying: ${retryCount}, Cancelled: ${cancelledCount}`);
    } catch (error) {
        console.error("❌ Error in sendPendingSmsMessages():", error);
    }
}

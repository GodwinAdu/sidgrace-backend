import cron from 'node-cron';
import { queueDueNotifications, sendPendingSmsMessages } from '../actions/message.actions';

/**
 * Every minute: queue due Messaging-page notifications, then send what is queued.
 * Run in sequence (not as two separate jobs) so freshly queued messages go out in the
 * same minute. Each step guards itself against overlapping runs.
 */
cron.schedule('*/1 * * * *', async () => {
    try {
        await queueDueNotifications();
        await sendPendingSmsMessages();
    } catch (error) {
        console.error("SMS job failed:", error);
    }
});

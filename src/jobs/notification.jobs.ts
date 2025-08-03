import cron from 'node-cron';
import { checkNotificationPending } from '../actions/notification.actions';

cron.schedule('*/1 * * * *', async () => {
    console.log("Running schedule sms job every 1 minutes");
    try {
        const response = await checkNotificationPending()

        if (response.success) {
            console.log('Scheduled SMS sent successfully,', response.message)
        } else {
            console.error('Failed to send scheduled SMS', response.message)
        }
        console.log("Running schedule sms job completed");
    } catch (error) {
        if (error instanceof Error) {
            console.log('Error running Scheduled SMS job:', error.message);
        } else {
            console.log('Error running Scheduled SMS job:', error);
        }
    }
});
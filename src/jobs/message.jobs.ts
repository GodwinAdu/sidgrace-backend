import cron from 'node-cron';
import { processIndividualMessages, sendPendingSmsMessages } from '../actions/message.actions';

cron.schedule('*/1 * * * *', async () => {
    console.log("✅ SMS Cron Job Initialized");
    try {
        const response = await processIndividualMessages()

        if (response.success) {
            console.log('Scheduled SMS sent successfully,', response.message)
        } else {
            console.error('Failed to send scheduled SMS', response.message)
        }
        console.log("Running schedule message job completed");
    } catch (error) {
        if (error instanceof Error) {
            console.log('Error running Scheduled SMS job:', error.message);
        } else {
            console.log('Error running Scheduled SMS job:', error);
        }
    }
});


cron.schedule('*/1 * * * *', async () => {
    console.log("🕐 Running scheduled SMS job every 1 minute");
    try {
        await sendPendingSmsMessages();
        console.log("✅ Scheduled SMS job completed");
    } catch (error) {
        console.error("❌ Error in scheduled SMS job:", error);
    }
});

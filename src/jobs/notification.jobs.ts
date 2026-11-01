import cron from 'node-cron';
import { checkNotificationPending } from '../actions/notification.actions';
import { log } from '../utils/logger';

/** Every minute: publish "pending" notifications whose scheduled time has arrived. */
cron.schedule('*/1 * * * *', async () => {
    try {
        const response = await checkNotificationPending();
        if (!response.success) log.error(`Publishing scheduled notifications failed: ${response.message}`);
        else if (response.data?.length) log.info(response.message);
    } catch (error) {
        log.error('Publishing scheduled notifications failed: ' + String(error));
    }
});

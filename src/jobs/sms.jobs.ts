import cron from 'node-cron';
import { sendSms } from '../controllers/sms.controller';
import { smsProvider } from '../actions/sms.actions';

const values = {
    message: `testing sms at JuTech Devs`,
    destination: "+233551556650"
}
cron.schedule('*/2 * * * *', async () => {
    console.log("Running schedule sms job every 2 minutes");
    try {
        // const response = await smsProvider(values)

        // if(response.success){
        //     console.log('Scheduled SMS sent successfully,',response.message)
        // }else {
        //     console.error('Failed to send scheduled SMS',response.message)
        // }
    } catch (error) {
        if (error instanceof Error) {
            console.log('Error running Scheduled SMS job:', error.message);
        } else {
            console.log('Error running Scheduled SMS job:', error);
        }
    }
});

cron.schedule('*/2 * * * *', async () => {
    console.log("Running schedule sms job every 2 minutes");
    try {
        // const response = await smsProvider(values)

        // if(response.success){
        //     console.log('Scheduled SMS sent successfully,',response.message)
        // }else {
        //     console.error('Failed to send scheduled SMS',response.message)
        // }
    } catch (error) {
        if (error instanceof Error) {
            console.log('Error running Scheduled SMS job:', error.message);
        } else {
            console.log('Error running Scheduled SMS job:', error);
        }
    }
});
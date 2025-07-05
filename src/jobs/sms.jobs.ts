import cron from 'node-cron';
import { sendSms } from '../controllers/sms.controller';
import { smsProvider } from '../actions/sms.actions';

const values = {
    message: `Tina - Adu said i should send you this. Adu is speaking ' I just want you to know that I love you so much, more than words can ever truly say. Every moment without you feels like a piece of me is missing. Your smile, your voice, your presence — I miss it all right now.
You are the light in my day, the peace in my nights, and the reason my heart beats a little faster. I may not be beside you this very moment, but I carry you with me in every thought and every heartbeat.
Just a little surprise to remind you how incredibly special you are to me.
I can’t wait to hold you again soon. 💕

With all my love,
Adu ❤️'

`,
    destination: "+233552484509"
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
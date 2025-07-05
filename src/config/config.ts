import dotenv from 'dotenv';

dotenv.config();

interface Config {
    port: number;
    nodeEnv: string;
    sms_username: string;
    sms_password: string;
    sms_source: string;
}

const config: Config = {
    port: Number(process.env.PORT) || 10000,
    sms_username: process.env.SMS_USERNAME!,
    sms_password: process.env.SMS_PASSWORD!,
    sms_source: process.env.SMS_SOURCE!,
    nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
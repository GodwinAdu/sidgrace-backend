import dotenv from 'dotenv';

dotenv.config();
interface Config {
    port: number;
    /** Interface to listen on. 127.0.0.1 = only this PC (the Next.js app calls us server-side). */
    host: string;
    nodeEnv: string;
    mongodbUrl: string;
    smsonline: {
        apiKey: string;
        senderId: string;
        baseUrl: string;
    };
    printRelay: {
        enabled: boolean;
        host: string;
        port: number;
        pfxPath: string;
        pfxPassphrase: string;
        printerIp: string;
        printerPort: number;
        /** Used to find the printer again if the router changes its IP. */
        printerMac: string;
        allowedOrigins: string[];
    };
}

const DEFAULT_PRINT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.214:3000",
    "https://*.vercel.app",
];

const config: Config = {
    port: Number(process.env.PORT) || 5000,
    host: process.env.HOST || '127.0.0.1',
    nodeEnv: process.env.NODE_ENV || 'development',
    mongodbUrl: process.env.MONGODB_URL!,
    smsonline: {
        apiKey: (process.env.SMSONLINEGH_API_KEY || '').trim(),
        senderId: (process.env.SMSONLINEGH_SENDER_ID || '').trim(),
        baseUrl: (process.env.SMSONLINEGH_BASE_URL || 'https://api.smsonlinegh.com/v5').replace(/\/+$/, ''),
    },
    printRelay: {
        enabled: (process.env.PRINT_RELAY_ENABLED || 'true').toLowerCase() !== 'false',
        // Listens on the LAN so other clinic PCs/laptops can print through this PC.
        host: process.env.PRINT_RELAY_HOST || '0.0.0.0',
        port: Number(process.env.PRINT_RELAY_PORT) || 5443,
        pfxPath: process.env.PRINT_RELAY_PFX || 'certs/print-relay.pfx',
        pfxPassphrase: process.env.PRINT_RELAY_PFX_PASSPHRASE || '',
        // Xprinter XP-E200L on the clinic network (ESC/POS over raw TCP 9100)
        printerIp: process.env.PRINTER_IP || '192.168.1.100',
        printerPort: Number(process.env.PRINTER_PORT) || 9100,
        printerMac: process.env.PRINTER_MAC || '00-61-7B-FB-41-E5',
        allowedOrigins: (process.env.PRINT_RELAY_ALLOWED_ORIGINS || '')
            .split(',').map((s) => s.trim()).filter(Boolean)
            .concat(process.env.PRINT_RELAY_ALLOWED_ORIGINS ? [] : DEFAULT_PRINT_ORIGINS),
    },
};

export default config;

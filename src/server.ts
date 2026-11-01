
import express from "express";
import { createServer } from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import { log } from "./utils/logger";
import config from "./config/config";
import routers from "./routes";
import './jobs/notification.jobs'
import './jobs/message.jobs'
import connectToDB from "./database/mongodb";
import { smsConfigProblem } from "./actions/sms.actions";
import { startPrintRelay } from "./print/relay";



const PORT = config.port || 5000;
const HOST = config.host || "127.0.0.1";

const app = express();
const server = createServer(app);

// Middleware
app.use(helmet());
app.use(morgan("dev"));
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());



// API Routes
app.use(routers);

app.get("/", (req, res) => {
    res.send("Welcome to the SidGrace Backend API! 🚀");
});

// Global Error Handler: Catches all unhandled errors and sends a generic 500 response.
// This middleware should be placed after all other routes and middleware.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    log.error("❌ ERROR: " + String(err));
    console.error("❌ ERROR:", err);
    res.status(500).json({ message: "Internal Server Error" });
});


// Start Server
const startServer = async () => {
    // Independent of the database: receipts must print even if MongoDB is slow to start.
    startPrintRelay();
    try {
         await connectToDB(); // Ensure DB is connected first
        // Bound to 127.0.0.1 by default: only the Next.js app on this PC calls this API
        // (from server actions), and the SMS route has no auth of its own, so it must
        // not be reachable from other machines on the network.
        server.listen(PORT, HOST, () => {
            log.info(`Server running on http://${HOST}:${PORT}`);
            const problem = smsConfigProblem();
            if (problem) log.error(`${problem} - SMS will be queued but not sent until this is fixed in .env`);
            else log.info(`SMS gateway: SMSOnlineGH, sender "${config.smsonline.senderId}"`);
        });
    } catch (error) {
        console.error("❌ Failed to start application:", error);
        process.exit(1); // Exit if server fails to start
    }
};

startServer();

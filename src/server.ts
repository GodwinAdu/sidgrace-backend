
import express from "express";
import { createServer } from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import { log } from "./utils/logger";
import config from "./config/config";
import routers from "./routes";
import './jobs/sms.jobs'



const PORT = config.port || 5000;

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
    res.send("Welcome to the CampusIQ Backend API! 🚀");
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
    try {
        server.listen(PORT, () => {
            log.info(`✅ Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start application:", error);
        process.exit(1); // Exit if server fails to start
    }
};

startServer();

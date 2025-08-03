
import mongoose from "mongoose";
import config from "../config/config";

const MONGODB_URL = config.mongodbUrl;

// Check if MONGODB_URL is loaded
if (!MONGODB_URL) {
    console.error("❌ MONGODB_URL is not defined in .env file!");
    process.exit(1);
}

const MAX_RETRIES = 5; // Maximum number of retries
const RETRY_DELAY = 2000; // Initial retry delay in milliseconds

const connectToDB = async (retries = 0) => {
    try {
        await mongoose.connect(MONGODB_URL, { dbName: "SidGrace" });
        console.log("Mongoose connection status:", mongoose.connection.readyState);

    } catch (error) {
        console.error("❌ Error connecting to MongoDB:", error);
        if (retries < MAX_RETRIES) {
            const delay = RETRY_DELAY * Math.pow(2, retries); // Exponential backoff
            console.log(`🔄 Retrying in ${delay / 1000} seconds... (${retries + 1}/${MAX_RETRIES})`);
            setTimeout(() => connectToDB(retries + 1), delay);
        } else {
            console.error("🚨 Maximum retry attempts reached. Exiting...");
            process.exit(1);
        }
    }
};

export default connectToDB;

import axios from "axios";
import { log } from "../utils/logger";

interface SmsProviderValues {
    destination: string;
    message: string;
}

/**
 * Sends an SMS message using the specified provider API.
 *
 * @param values - An object containing the SMS provider credentials and message details.
 * @param values.username - The username for authentication with the SMS provider.
 * @param values.password - The password for authentication with the SMS provider.
 * @param values.source - The sender ID or source of the SMS.
 * @param values.destination - The recipient's phone number.
 * @param values.message - The content of the SMS message.
 * @param values.ol - Additional parameter required by the SMS provider.
 * @returns A promise that resolves to an object indicating the success status and a message or error.
 */

export async function smsProvider(values: SmsProviderValues) {
    try {
        const {
            destination,
            message,
        } = values

        const response = await axios.post('https://deywuro.com/api/sms', {
            username:process.env.SMS_USERNAME!,
            password:process.env.SMS_PASSWORD!,
            source:process.env.SMS_SOURCE!,
            destination,
            message,
            ol:false
        });

        if (response.data.code === 0) {
            return { success: true, message: response.data.message }
        } else {
            return { success: false, message: response.data.message }
        }
    } catch (error) {
        log.error('Error sending Sms: ' + String((error as Error).message || error))
        return { success: false, message: "Failed to send SMS" }
    }
}
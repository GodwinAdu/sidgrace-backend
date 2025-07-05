import { smsProvider } from "../actions/sms.actions";
import { log } from "../utils/logger"
import { Request, Response } from "express";

export async function sendSms(req: Request, res: Response) {
    try {
        const { destination, message } = req.body;
        const values = { destination, message }
        if (!destination || !message) {
            return res.status(400).json({ success: false, error: 'Missing required field' })
        };


        const result = await smsProvider(values)

        if (result.success) {
            res.status(200).json(result)
        } else {
            res.status(500).json(result)
        }
    } catch (error) {
        console.log("Error in send sms", error)
        log.error(String(error))
    }
}
import { Router, Request, Response } from "express";
import { sendSms } from "../controllers/sms.controller";

const smsRouter = Router();

smsRouter.post('/send-sms', sendSms as unknown as any);


export default smsRouter;
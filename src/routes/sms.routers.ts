import { Router } from "express";
import { getSmsBalance, runSmsQueue, sendSms } from "../controllers/sms.controller";

const smsRouter = Router();

smsRouter.post('/send-sms', sendSms as unknown as any);
smsRouter.get('/balance', getSmsBalance as unknown as any);
smsRouter.post('/queue/run', runSmsQueue as unknown as any);


export default smsRouter;

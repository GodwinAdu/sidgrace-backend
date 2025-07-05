
import { Router } from "express";
import smsRouter from "./sms.routers";

const routers = Router();
routers.use("/api/v1/sms", smsRouter);


export default routers;
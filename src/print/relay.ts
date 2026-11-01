/**
 * Print relay
 * ===========
 * Lets the ONLINE app (https://...vercel.app) print to the clinic's network receipt
 * printer. The cloud server cannot reach 192.168.1.158, but a browser inside the clinic
 * can reach this PC, so the browser sends the receipt here and we forward it to the
 * printer on port 9100.
 *
 *   Browser (online app) --HTTPS--> https://<this PC>:5443/print --TCP 9100--> Xprinter
 *
 * Requirements the browser imposes, all handled here:
 *  - HTTPS (an https page may not call http://192.168.x.x): self-signed certificate made
 *    by scripts\setup-print-relay.ps1 and trusted once on each printing PC.
 *  - CORS: only origins in PRINT_RELAY_ALLOWED_ORIGINS are answered.
 *  - Private/Local Network Access: Chrome sends "Access-Control-Request-Private-Network"
 *    on the preflight and needs "Access-Control-Allow-Private-Network: true" back
 *    (newer Chrome also shows a one-time "access local network" permission prompt).
 *
 * Unlike the SMS API (127.0.0.1 only), this listens on the LAN, but it can only print
 * receipts: no database, no SMS, payload validated and size/rate limited.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import express, { NextFunction, Request, Response } from "express";
import config from "../config/config";
import { log } from "../utils/logger";
import { buildReceiptBytes, probePrinter, sanitizeReceipt, sendToPrinter } from "./escpos";
import { resolvePrinterIp } from "./locate";

const RATE_LIMIT = 30;            // print requests per minute per client IP
const hits = new Map<string, { count: number; reset: number }>();

/** "https://*.vercel.app" style patterns -> RegExp */
function originMatchers(list: string[]): RegExp[] {
    return list.map((o) => new RegExp(
        "^" + o.trim().replace(/\/+$/, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+") + "$",
        "i"
    ));
}

export function startPrintRelay() {
    const r = config.printRelay;
    if (!r.enabled) { log.info("Print relay disabled (PRINT_RELAY_ENABLED=false)"); return; }

    const pfxPath = path.resolve(process.cwd(), r.pfxPath);
    if (!fs.existsSync(pfxPath)) {
        log.error(`Print relay not started: certificate ${pfxPath} not found. Run scripts\\setup-print-relay.ps1 as Administrator.`);
        return;
    }

    const allowed = originMatchers(r.allowedOrigins);
    const app = express();
    app.disable("x-powered-by");

    // CORS + Private Network Access
    app.use((req: Request, res: Response, next: NextFunction): void => {
        const origin = req.headers.origin;
        if (origin) {
            if (!allowed.some((rx) => rx.test(origin))) {
                log.error(`Print relay: blocked request from origin ${origin}`);
                res.status(403).json({ ok: false, error: "Origin not allowed" });
                return;
            }
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            res.setHeader("Access-Control-Max-Age", "600");
        }
        if (req.headers["access-control-request-private-network"]) {
            res.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        if (req.method === "OPTIONS") { res.status(204).end(); return; }
        next();
    });

    app.use(express.json({ limit: "64kb" }));

    app.get("/", (_req: Request, res: Response): void => {
        res.type("text").send("SidGrace print relay is running. You can close this tab.");
    });

    // Public certificate only (never the .pfx), for scripts\install-print-cert.cmd on client PCs.
    app.get("/print-relay.cer", (_req: Request, res: Response): void => {
        const cer = path.join(path.dirname(pfxPath), "print-relay.cer");
        if (!fs.existsSync(cer)) { res.status(404).send("Certificate not found"); return; }
        res.type("application/pkix-cert").sendFile(cer);
    });

    app.get("/health", async (_req: Request, res: Response): Promise<void> => {
        const ip = await resolvePrinterIp(r.printerIp, r.printerPort, r.printerMac);
        const reachable = await probePrinter(ip, r.printerPort);
        res.json({ ok: true, printer: `${ip}:${r.printerPort}`, printerReachable: reachable });
    });

    app.post("/print", async (req: Request, res: Response): Promise<void> => {
        const ip = req.socket.remoteAddress || "?";
        const now = Date.now();
        const h = hits.get(ip);
        if (!h || h.reset < now) hits.set(ip, { count: 1, reset: now + 60_000 });
        else if (++h.count > RATE_LIMIT) { res.status(429).json({ ok: false, error: "Too many print requests, wait a minute" }); return; }

        const { data, error } = sanitizeReceipt(req.body);
        if (!data) { res.status(400).json({ ok: false, error }); return; }

        const printerIp = await resolvePrinterIp(r.printerIp, r.printerPort, r.printerMac);
        const result = await sendToPrinter(printerIp, r.printerPort, buildReceiptBytes(data));
        if (!result.ok) {
            log.error(`Print relay: printer ${printerIp}:${r.printerPort} failed: ${result.error}`);
            res.status(502).json({ ok: false, error: `${result.error || "Printer unreachable"}. Check the printer is on and connected to the router.`, printer: `${printerIp}:${r.printerPort}` });
            return;
        }
        log.info(`Print relay: printed ${data.title ?? "receipt"} ${data.docNumber ?? ""} (${result.bytes} bytes) for ${req.headers.origin ?? ip}`);
        res.json({ ok: true, bytes: result.bytes, printer: `${printerIp}:${r.printerPort}` });
    });

    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
        log.error("Print relay error: " + String(err));
        res.status(400).json({ ok: false, error: "Bad request" });
    });

    try {
        const server = https.createServer({ pfx: fs.readFileSync(pfxPath), passphrase: r.pfxPassphrase }, app);
        server.on("error", (e) => log.error("Print relay server error: " + String(e)));
        server.listen(r.port, r.host, () => {
            log.info(`Print relay on https://${r.host}:${r.port} -> printer ${r.printerIp}:${r.printerPort}; origins: ${r.allowedOrigins.join(", ")}`);
        });
    } catch (e) {
        log.error("Print relay not started (certificate/passphrase problem?): " + String(e));
    }
}

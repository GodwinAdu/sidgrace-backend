# SidGrace Backend (SMS service)

Small Express + TypeScript service that sends SMS for the SidGrace app through
[SMSOnlineGH](https://dev.smsonlinegh.com/docs/v5/http/rest). It runs on the same PC as the
app, shares its local MongoDB (database `SidGrace`) and keeps the SMS history in the
`messages` collection.

```
Browser (any PC/laptop) ──> Next.js app :3000 ──(server side)──> this service 127.0.0.1:5000 ──> SMSOnlineGH
                                    │                                   │
                                    └──────────── MongoDB 127.0.0.1:27017 (SidGrace) ──┘
```

## Setup

Requirements: Node.js 20+, MongoDB running locally.

```powershell
npm install
copy .env.example .env      # then fill in the values (see below)
npm run build
npm start                   # or: npm run dev  (auto-reload while editing)
```

The app's launcher (`sidgrace_opticals-main\scripts\start-local.ps1`, used by the desktop and
Startup shortcuts) starts this service automatically from `..\sidgrace-backend`. Logs then go
to `%LOCALAPPDATA%\SidGrace\logs\backend-out.log` / `backend-err.log`.

### `.env`

| Key | Required | Notes |
|---|---|---|
| `SMSONLINEGH_API_KEY` | yes | Portal: account settings, API configuration, generate API key |
| `SMSONLINEGH_SENDER_ID` | yes | Must be requested **and approved** in the portal (SMS Messaging, Sender Names). Max 11 characters |
| `MONGODB_URL` | yes | `mongodb://127.0.0.1:27017` |
| `PORT` | no | Default `5000`. The app's `NEXT_PUBLIC_API_URL` must match |
| `HOST` | no | Default `127.0.0.1` (this PC only). Keep it: the API has no login of its own |
| `SMSONLINEGH_BASE_URL` | no | Default `https://api.smsonlinegh.com/v5` |

Restart the service after changing `.env` (sign out of Windows and back in, or reboot, or stop
the `node` process running `dist\server.js` and double-click the app shortcut).

## How sending works

| Source | Path |
|---|---|
| Messaging page (individual or bulk, now or scheduled) | App saves a `Notification`; every minute (or immediately via `queue/run`) the service turns due notifications into one `Message` per patient and sends them |
| Patient welcome, staff welcome, appointment confirmation, recall reminder | App calls `POST /api/v1/sms/send-sms`; sent immediately and recorded as a `Message` |

Every message ends in one of these states (visible in the app under Messaging, SMS, History):

| Status | Meaning |
|---|---|
| `pending` (Queued) | Waiting to be sent or retried |
| `sent` | Accepted by SMSOnlineGH (`handshake 0`, destination not rejected) |
| `failed` | Permanent problem: invalid number, no phone on file, number rejected. Not retried |
| `cancelled` | Temporary problem never cleared (retried at +1, 5, 15, 60, 180 min) or older than 24 h |

Temporary problems (no internet, gateway down, bad key, no credit) keep messages queued, so
nothing is lost while the internet is down. If the gateway is not configured, messages wait in
the queue and go out once the key is set (unless older than 24 hours).

Bulk sends skip patients who are inactive, archived or deceased; no SMS is ever sent to a
deceased patient. Phone numbers are normalised to `233XXXXXXXXX` (`024...`, `+233 24...`, `0024...`).

## API (127.0.0.1 only)

| Method | Path | Body / response |
|---|---|---|
| `POST` | `/api/v1/sms/send-sms` | `{ destination, message, recipientName?, source? }` → `200` sent, `202` queued for retry, `422` permanent failure, `400` invalid input |
| `GET` | `/api/v1/sms/balance` | `{ success, configured, senderId, data: { balance, model } }` |
| `POST` | `/api/v1/sms/queue/run` | Starts a queue run now; responds `202` immediately |

Quick checks (PowerShell, on the host PC):

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/v1/sms/balance
Invoke-RestMethod http://127.0.0.1:5000/api/v1/sms/send-sms -Method Post -ContentType application/json `
  -Body '{"destination":"024XXXXXXX","message":"Test from SidGrace","source":"direct"}'
```

## Print relay (receipts from the online app)

The online app runs on Vercel, which cannot reach the clinic's Xprinter (192.168.1.x is a
private address). The relay lets the **browser** in the clinic print instead:

```
Browser on a clinic PC (online or local app) --HTTPS--> https://192.168.1.214:5443/print --TCP 9100--> Xprinter XP-E200L
```

The app's Print Receipt tries, in order: relay, the app's own `/api/print-receipt` (local
version only), then the browser print dialog.

**One-time setup**

1. Host PC, as Administrator: `powershell -ExecutionPolicy Bypass -File scripts\setup-print-relay.ps1`
   (creates `certs\` and the firewall rule, writes `PRINT_RELAY_PFX_PASSPHRASE` to `.env`), then restart the backend.
2. Every other PC/laptop that prints: copy `scripts\install-print-cert.cmd`, right-click, Run as administrator.
3. App settings (local `.env.local` **and** Vercel environment variables):
   `NEXT_PUBLIC_PRINT_RELAY_URL=https://192.168.1.214:5443`, then rebuild / redeploy.
4. First print in Chrome/Edge may ask to allow access to devices on the local network: Allow.

**Settings (`.env`)**: `PRINTER_IP`, `PRINTER_PORT` (9100), `PRINTER_MAC` (used to find the
printer again if the router changes its IP), `PRINT_RELAY_PORT` (5443),
`PRINT_RELAY_ALLOWED_ORIGINS` (comma-separated; `*` wildcard allowed, e.g. `https://*.vercel.app`).

**Endpoints** (LAN, HTTPS): `GET /health` (printer reachable?), `POST /print` (receipt JSON,
same shape as the app's `/api/print-receipt`), `GET /print-relay.cer` (public certificate for
client PCs). Only allowed origins get a response; payloads are validated, max 64 KB, 30 prints
per minute per PC. The relay can only print: it has no database or SMS access.

If the host PC's IP changes: re-run step 1 and 2, and update `NEXT_PUBLIC_PRINT_RELAY_URL`.

## Not included

- **Delivery reports** (handset delivered / undelivered). SMSOnlineGH can push them to a public
  callback URL, which this PC does not have; `sent` therefore means "accepted by the gateway".
- **Email** notifications.

/**
 * Finds the Xprinter on the LAN even when the router gives it a new IP (DHCP).
 *
 * 1. Try the last known address (starts as PRINTER_IP from .env).
 * 2. If it does not answer on port 9100, look the printer up by MAC address
 *    (PRINTER_MAC) in the Windows ARP table.
 * 3. Still not found: try port 9100 on every address of the /24 subnet (a few hundred
 *    millisecond-long TCP connects in parallel), then confirm the MAC via ARP.
 *
 * The permanent fix is a DHCP reservation in the router (MAC -> fixed IP); this keeps
 * printing working until that is done, or if it is ever lost.
 */
import { execFile } from "node:child_process";
import { probePrinter } from "./escpos";
import { log } from "../utils/logger";

let currentIp: string | null = null;
let locating: Promise<string | null> | null = null;

const normMac = (m: string) => m.toLowerCase().replace(/[^0-9a-f]/g, "");

function arpTable(): Promise<Map<string, string>> {
    return new Promise((resolve) => {
        execFile("arp", ["-a"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
            const map = new Map<string, string>(); // mac -> ip
            if (!err) {
                for (const line of stdout.split(/\r?\n/)) {
                    const m = line.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s/i);
                    if (m) map.set(normMac(m[2]), m[1]);
                }
            }
            resolve(map);
        });
    });
}

async function sweep(subnet: string, port: number): Promise<string[]> {
    const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
    const open: string[] = [];
    // 64 at a time keeps it gentle on the network and the PC
    for (let i = 0; i < ips.length; i += 64) {
        const chunk = ips.slice(i, i + 64);
        const results = await Promise.all(chunk.map(async (ip) => ((await probePrinter(ip, port, 600)) ? ip : null)));
        open.push(...(results.filter(Boolean) as string[]));
    }
    return open;
}

async function locate(configuredIp: string, port: number, mac: string): Promise<string | null> {
    const want = normMac(mac);
    if (!want) return null;

    let byMac = (await arpTable()).get(want);
    if (byMac && (await probePrinter(byMac, port))) return byMac;

    const subnet = configuredIp.split(".").slice(0, 3).join(".");
    const open = await sweep(subnet, port);
    byMac = (await arpTable()).get(want);
    if (byMac && open.includes(byMac)) return byMac;
    // Exactly one device with 9100 open and MAC unknown (e.g. ARP blocked): use it.
    if (open.length === 1) return open[0];
    return null;
}

/**
 * Returns an IP where the printer answers on `port`, or the configured IP if it cannot
 * be found (the caller then reports "printer unreachable").
 */
export async function resolvePrinterIp(configuredIp: string, port: number, mac: string): Promise<string> {
    const candidate = currentIp ?? configuredIp;
    if (await probePrinter(candidate, port, 1500)) return candidate;

    if (!locating) {
        locating = locate(configuredIp, port, mac).finally(() => { locating = null; });
    }
    const found = await locating;
    if (found) {
        if (found !== currentIp) {
            log.info(`Printer found at ${found} (MAC ${mac}); was ${candidate}. Reserve this address in the router to stop it changing.`);
        }
        currentIp = found;
        return found;
    }
    return candidate;
}

export function lastKnownPrinterIp(configuredIp: string) {
    return currentIp ?? configuredIp;
}

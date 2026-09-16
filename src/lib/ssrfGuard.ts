import { lookup } from 'node:dns/promises';
import net from 'node:net';

// SSRF guard for OUTBOUND URLs the store will POST to on a third party's say-so
// (partner webhook delivery_url). A hostname regex is not enough: `foo.internal`,
// a decimal-encoded IP, an IPv6 form, or a public name whose DNS record points
// at a private address all slip past it. This resolves the host and rejects if
// ANY resolved address is private/loopback/link-local/unique-local. Enforced at
// registration AND again immediately before each send (DNS can be re-pointed
// after registration — classic TOCTOU rebind).

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → treat as unsafe
  const a = p[0]!, b = p[1]!;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||               // link-local
    (a === 172 && b >= 16 && b <= 31) ||      // 172.16/12
    (a === 192 && b === 168) ||               // 192.168/16
    (a === 100 && b >= 64 && b <= 127) ||     // CGNAT 100.64/10
    a >= 224                                   // multicast/reserved
  );
}
// Expand any IPv6 spelling to its 8 hextets (numbers). Handles '::' compression,
// a trailing embedded dotted IPv4, and zone ids. Returns null if unparseable.
function expandV6(ipRaw: string): number[] | null {
  let s = ipRaw.toLowerCase();
  const pct = s.indexOf('%'); if (pct >= 0) s = s.slice(0, pct); // strip zone id
  let tail: number[] = [];
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted) {
    const q = dotted[1]!.split('.').map(Number);
    if (q.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    tail = [((q[0]! << 8) | q[1]!), ((q[2]! << 8) | q[3]!)];
    s = s.slice(0, dotted.index).replace(/:$/, ':').replace(/:$/, ''); // drop the dotted group, keep the '::' if present
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toNums = (chunk: string): number[] => (chunk ? chunk.split(':').filter((x) => x !== '') : []).map((h) => parseInt(h, 16));
  const head = toNums(halves[0] ?? '');
  const right = halves.length === 2 ? toNums(halves[1] ?? '') : null;
  let hextets: number[];
  if (right === null) {
    hextets = [...head, ...tail];
  } else {
    const known = head.length + right.length + tail.length;
    const zeros = 8 - known;
    if (zeros < 0) return null;
    hextets = [...head, ...Array(zeros).fill(0), ...right, ...tail];
  }
  if (hextets.length !== 8 || hextets.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return hextets;
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true; // link-local + unique-local
  // Embedded IPv4 in the low 32 bits — check it as IPv4 regardless of spelling.
  // The old code matched ONLY the dotted form (::ffff:127.0.0.1); the HEX form
  // ::ffff:7f00:1 (= 127.0.0.1) passed straight through, reaching loopback /
  // link-local metadata (audit). Only treat the low 32 bits as IPv4 when the high
  // bits mark it embedded (::ffff: mapped, :: compat, or the 64:ff9b:: NAT64
  // prefix) — a normal public IPv6 whose low bits merely look private is NOT
  // touched, so no false-positive on legitimate hosts.
  const h = expandV6(s);
  if (!h) return true; // unparseable → unsafe
  const zeroHigh = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
  const mapped = zeroHigh && h[5] === 0xffff;
  const compat = zeroHigh && h[5] === 0;
  const nat64 = h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0;
  if (mapped || compat || nat64) {
    const v4 = `${h[6]! >> 8}.${h[6]! & 0xff}.${h[7]! >> 8}.${h[7]! & 0xff}`;
    return isPrivateV4(v4);
  }
  return false;
}
function isPrivateIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateV4(ip) : net.isIPv6(ip) ? isPrivateV6(ip) : true;
}

export interface SsrfCheck { ok: boolean; reason?: string }

/** Validate an outbound URL: https only, resolvable, and no private targets. */
export async function assertPublicHttpsUrl(raw: string): Promise<SsrfCheck> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'not a valid URL' }; }
  // Integration tests deliver to a loopback HTTP server. This opt-out disables
  // the guard ENTIRELY and must never be set in production — it is set only by
  // the outbound-webhook test harness.
  if (process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === '1') return { ok: true };
  if (url.protocol !== 'https:') return { ok: false, reason: 'must be HTTPS' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // A literal IP in the host is checked directly.
  if (net.isIP(host)) return isPrivateIp(host) ? { ok: false, reason: 'resolves to a private address' } : { ok: true };
  // Otherwise resolve every A/AAAA and reject if any is private.
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return { ok: false, reason: 'host does not resolve' };
    for (const a of addrs) if (isPrivateIp(a.address)) return { ok: false, reason: 'host resolves to a private address' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'host does not resolve' };
  }
}

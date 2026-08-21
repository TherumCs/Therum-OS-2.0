import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { COOKIE_NAME } from './session';

const API = process.env.API_URL ?? 'http://localhost:4100';
// NO fallback value. This previously defaulted to the shipped dev placeholder,
// which meant a deployment that simply forgot JWT_SECRET would mint admin
// tokens signed with a secret published in this repository — and would do it
// silently, looking completely healthy. Failing here is the only safe
// behaviour; lib/session.ts already refuses for the same reason.
function signingSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET must be set — see admin/.env.example (it must match the backend).');
  }
  return secret;
}

// Synthetic fallback token for the rare context with no real session (build
// time, or a route outside the auth gate). It is deliberately INERT: role
// 'anon-ui' is not one of the two the backend accepts ('admin' | 'custom',
// see src/middleware/auth.ts), so presenting it earns a 401, not data.
//
// It used to claim role 'admin'. That made it a privilege-escalation trap:
// the backend grants a validly-signed 'admin' token full access without even
// checking the AdminUser exists, so any hole in the proxy matcher (there was
// one once — bare /tos-admin rendered unauthenticated, see admin/proxy.ts)
// turned a routing miss into full admin API access for an anonymous visitor.
// Every real page is force-dynamic and renders behind the gate with a real
// session cookie; the login screen reads dedicated /public endpoints. Nothing
// legitimate depends on this token succeeding, so it fails closed.
function mintFallbackToken(): string {
  const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'admin-ui', role: 'anon-ui', iat: now, exp: now + 3600 })}`;
  return `${data}.${createHmac('sha256', signingSecret()).update(data).digest('base64url')}`;
}

// Forward the real logged-in admin's own session token (same JWT the backend
// already verifies on every route) rather than always minting a placeholder
// — this used to be fine when nothing was per-user, but per-user state (e.g.
// dashboard card layout) needs the actual AdminUser id in `sub`, not a shared
// synthetic one every request used to claim.
// Next 16: cookies() is async-only (no sync fallback) — every caller of this
// function is itself an async Server Component / Route Handler / Server
// Action already, so `await`ing here doesn't change any caller's own shape.
export async function authToken(): Promise<string> {
  const store = await cookies();
  const real = store.get(COOKIE_NAME)?.value;
  return real ?? mintFallbackToken();
}

export async function apiGet<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${await authToken()}`, ...extraHeaders },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

// This app's own server-side calls to the backend are always a hardcoded
// `fetch('http://localhost:4100/...')` — an internal hop that never carries
// whatever public host the actual browser is on (nginx forwards the real
// Host to THIS app correctly; it's the next hop, from here to the backend,
// that loses it). Anywhere the backend needs to build a real public URL
// (SEO canonical/JSON-LD in /preview/[id]) has to re-forward what this app
// itself received, the same standard X-Forwarded-Host/-Proto pair nginx
// already uses one hop up (see conf/nginx/site.conf.hbs).
export async function forwardedOriginHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return {};
  return { 'x-forwarded-host': host, 'x-forwarded-proto': h.get('x-forwarded-proto') ?? 'http' };
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await authToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export function apiBase(): string {
  return API;
}

// For Route Handlers that CLIENT-SIDE JS calls directly (2FA enroll/confirm,
// API token issue — anywhere the response needs to reach client state
// as-is, e.g. a "reveal this secret once" value, rather than a page
// redirect). The browser can't call the raw backend itself: it sends the
// httpOnly session cookie automatically, but the backend's app.authenticate
// reads an Authorization header, not a cookie — nothing bridges the two
// without a same-origin Route Handler forwarding the real token server-side.
// Passes the backend's status and JSON body through unchanged, error shape
// included, so the client can render whatever { error: { message } } the
// backend actually returned instead of a generic proxy failure.
export async function proxyToBackend(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await authToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
}

const BUILDER_URL = process.env.NEXT_PUBLIC_BUILDER_URL ?? 'http://localhost:5174';

// Hand off to the builder to author a content item's canvas body. The edit
// token rides in the URL (the real logged-in admin's own session token) —
// fine for an internal authoring handoff; harden to a scoped token /
// postMessage later.
// Takes an already-resolved token rather than calling authToken() itself:
// callers building a list of these (one per content item) resolve the
// (identical, session-wide) token once and pass it in, instead of each
// item re-awaiting cookies() redundantly.
export function builderEditUrl(contentId: string, token: string): string {
  return `${BUILDER_URL}/?content=${encodeURIComponent(contentId)}&token=${encodeURIComponent(token)}`;
}

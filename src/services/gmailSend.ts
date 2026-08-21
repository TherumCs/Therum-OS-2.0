import { connectionService } from './connection.service.js';
import { randomUUID } from 'node:crypto';

// Sending mail through the store owner's own Google account.
//
// Why this exists: the contact form was posting fine and delivering nothing,
// because no mail transport was configured — no Resend/SendGrid/Postmark key
// and an empty smtpHost. The account we DO have is Google, already connected
// for admin sign-in.
//
// That sign-in connection cannot be reused as-is: it holds only
// openid/email/profile, and Google will not let an access token minted for
// those scopes touch Gmail. So this is a SEPARATE authorisation, stored under
// its own provider id, holding a refresh token for `gmail.send` alone —
// permission to send mail and nothing else. Sign-in keeps working if this is
// revoked, and revoking sign-in does not silently disable mail.
//
// A refresh token is used rather than an app password deliberately: an app
// password is a permanent credential over the whole mailbox that has to be
// typed in, and this grant is narrow, auditable in the Google account, and
// revocable from there without touching anything else.

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_PROVIDER = 'google-gmail';

interface GmailCredential {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  email: string;
}

export function parseGmailCredential(raw: string | null): GmailCredential | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GmailCredential>;
    if (!v.refreshToken || !v.clientId || !v.clientSecret) return null;
    return {
      refreshToken: v.refreshToken,
      clientId: v.clientId,
      clientSecret: v.clientSecret,
      email: v.email ?? '',
    };
  } catch {
    return null;
  }
}

// Access tokens last an hour; the refresh token is the durable half. Cached in
// memory only — a restart just costs one extra token call, and writing short
// lived tokens to the database would be storing a credential we do not need to
// keep.
let cached: { token: string; expires: number } | null = null;

async function accessToken(cred: GmailCredential): Promise<string | null> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) return null;
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/**
 * RFC 2822 message, base64url encoded, which is what the Gmail API takes.
 *
 * Header values are stripped of CR and LF before they go in. A newline in a
 * subject or a display name is header injection — it would let anything that
 * reaches this function append its own headers, Bcc included.
 */
export function buildRawMessage(msg: { to: string; from: string; subject: string; body: string; html?: string }): string {
  const strip = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim();
  // Header values are ASCII per RFC 5322; a non-ASCII Subject (an em-dash, or a
  // product name in another script) must be an RFC 2047 encoded-word, or clients
  // render the raw UTF-8 bytes as mojibake ("Ã¢Â€Â"" instead of "—"). Addresses
  // stay literal — only free-text header values get encoded.
  const encWord = (v: string): string => {
    const clean = strip(v);
    return /[^\x00-\x7F]/.test(clean) ? `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=` : clean;
  };
  const head = [
    `From: ${strip(msg.from)}`,
    `To: ${strip(msg.to)}`,
    `Subject: ${encWord(msg.subject)}`,
    'MIME-Version: 1.0',
  ];
  // Plain-text-only when there is no HTML part — the original behaviour.
  if (!msg.html) {
    const lines = [...head, 'Content-Type: text/plain; charset="UTF-8"', '', msg.body];
    return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
  }
  // multipart/alternative: a plain-text fallback plus the HTML. Both parts are
  // base64-encoded so a long HTML line never trips the SMTP 998-char limit (the
  // reason an HTML email silently degraded to text before).
  const b = `=_sm_${randomUUID()}`;
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const lines = [
    ...head,
    `Content-Type: multipart/alternative; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(msg.body),
    `--${b}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(msg.html),
    `--${b}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

/** Returns false rather than throwing, so the sender chain moves on. */
export async function viaGmail(msg: { to: string; from: string; subject: string; body: string; html?: string }): Promise<boolean> {
  const cred = parseGmailCredential(await connectionService.credentialFor(GMAIL_PROVIDER));
  if (!cred) return false;
  const token = await accessToken(cred);
  if (!token) return false;
  // Gmail sends as the authorised mailbox whatever From is claimed, so the
  // stored address is used when we have it — a From the account cannot send
  // as is a fast route into spam folders.
  const from = cred.email || msg.from;
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: buildRawMessage({ ...msg, from }) }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** For the settings screen: is Gmail sending wired up, and as whom. */
export async function gmailStatus(): Promise<{ ready: boolean; email: string }> {
  const cred = parseGmailCredential(await connectionService.credentialFor(GMAIL_PROVIDER));
  return { ready: Boolean(cred), email: cred?.email ?? '' };
}

// Gmail consent reuses the sign-in callback URL, because that is the one
// already registered against the Google client — a second redirect path would
// mean editing the Google console before mail could work at all, and an
// unregistered URI is exactly the redirect_uri_mismatch this hit first time.
// The signed state distinguishes the two flows; the prefix cannot be forged
// because the state is HMAC-signed.
export const GMAIL_STATE_PREFIX = '/__gmail__';

/**
 * Exchange the consent code and store the grant. Returns a reason rather than
 * throwing so the caller can put it in a redirect the admin actually sees.
 */
export async function storeGmailGrant(
  app: { clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const token = (await res?.json().catch(() => null)) as
    { refresh_token?: string; access_token?: string } | null;

  // No refresh token means Google treated this as an already-granted consent.
  // Storing the access token instead would send mail for an hour and then stop
  // silently, which is worse than refusing here.
  if (!token?.refresh_token) return { ok: false, reason: 'gmail_no_refresh_token' };

  let email = '';
  if (token.access_token) {
    const who = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    email = ((await who?.json().catch(() => null)) as { email?: string } | null)?.email ?? '';
  }

  const { connectionService } = await import('./connection.service.js');
  await connectionService.connect(
    GMAIL_PROVIDER,
    JSON.stringify({ refreshToken: token.refresh_token, clientId: app.clientId, clientSecret: app.clientSecret, email }),
    'google-oauth',
    'oauth',
  );
  cached = null; // a new grant must not keep serving the old account's token
  return { ok: true };
}

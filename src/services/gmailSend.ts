import { connectionService } from './connection.service.js';

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
export function buildRawMessage(msg: { to: string; from: string; subject: string; body: string }): string {
  const header = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim();
  const lines = [
    `From: ${header(msg.from)}`,
    `To: ${header(msg.to)}`,
    `Subject: ${header(msg.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    msg.body,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

/** Returns false rather than throwing, so the sender chain moves on. */
export async function viaGmail(msg: { to: string; from: string; subject: string; body: string }): Promise<boolean> {
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

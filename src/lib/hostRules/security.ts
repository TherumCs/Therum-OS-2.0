import type { Rule } from './types.js';
import { bool, num, str } from './types.js';

// Security rules. The 'any'-scoped half is the half that has actually bitten
// this project — an unignored .env, a service on 0.0.0.0, a placeholder
// signing secret. Those are all findable on a laptop, which is why they run
// there rather than waiting for a server to exist.

export const securityRules: Rule[] = [
  {
    id: 'sec.jwt-placeholder',
    axis: 'security',
    scope: 'any',
    probes: ['secrets'],
    evaluate: (d) => {
      const s = d['secrets']!;
      if (!bool(s['jwtPlaceholder'])) return null;
      return {
        id: 'sec.jwt-placeholder',
        axis: 'security',
        severity: 'critical',
        title: 'JWT secret is still a placeholder',
        detail: `JWT_SECRET matches a shipped example value (${num(s['jwtLength'])} chars).`,
        why:
          'The signing secret is public. Anyone who has seen this repository can mint a valid admin session token — ' +
          'no password, no 2FA, full access. This is the single worst configuration state this install can be in.',
        fix: 'Generate a new one and restart both processes:\n\n  openssl rand -base64 48\n\nSet JWT_SECRET in .env and admin/.env to the SAME value.',
      };
    },
  },
  {
    id: 'sec.jwt-weak',
    axis: 'security',
    scope: 'any',
    probes: ['secrets'],
    evaluate: (d) => {
      const s = d['secrets']!;
      const len = num(s['jwtLength']);
      if (bool(s['jwtPlaceholder']) || len === 0 || len >= 32) return null;
      return {
        id: 'sec.jwt-weak',
        axis: 'security',
        severity: 'high',
        title: 'JWT secret is short',
        detail: `JWT_SECRET is ${len} characters; 32 is the practical floor for HS256.`,
        why: 'A short HMAC secret is brute-forceable offline once an attacker holds any single issued token.',
        fix: 'openssl rand -base64 48 — set the same value in .env and admin/.env, then restart both.',
      };
    },
  },
  {
    id: 'sec.credential-key',
    axis: 'security',
    scope: 'any',
    probes: ['secrets'],
    evaluate: (d) => {
      const s = d['secrets']!;
      if (!bool(s['credentialKeyPlaceholder'])) return null;
      return {
        id: 'sec.credential-key',
        axis: 'security',
        severity: 'critical',
        title: 'Credential encryption key is a placeholder',
        detail: 'CREDENTIAL_KEY matches a shipped example value.',
        why:
          'Every connected provider credential in Nexus is encrypted with this key. A known key means the stored ' +
          'API keys are effectively plaintext to anyone who reaches the database.',
        fix:
          'Rotate the key, then RE-CONNECT each provider in Nexus — existing rows cannot be decrypted with a new key. ' +
          'Rotate the provider-side keys too, since the old ones should be considered exposed.',
      };
    },
  },
  {
    id: 'sec.cors-wildcard',
    axis: 'security',
    scope: 'any',
    probes: ['secrets'],
    evaluate: (d) => {
      const origin = str(d['secrets']!['corsOrigin']);
      if (origin !== '*') return null;
      return {
        id: 'sec.cors-wildcard',
        axis: 'security',
        severity: 'high',
        title: 'CORS allows any origin',
        detail: 'CORS_ORIGIN is "*".',
        why: 'Any website a logged-in admin visits can call this API with their session and read the response.',
        fix: 'Set CORS_ORIGIN to the exact admin origin, comma-separated if there is more than one.',
      };
    },
  },
  {
    id: 'sec.env-tracked',
    axis: 'security',
    scope: 'any',
    probes: ['git-secrets'],
    evaluate: (d) => {
      const g = d['git-secrets']!;
      if (!bool(g['available'])) return null;
      const tracked = (g['tracked'] as string[]) ?? [];
      if (tracked.length === 0) return null;
      return {
        id: 'sec.env-tracked',
        axis: 'security',
        severity: 'critical',
        title: 'Environment file is tracked in git',
        detail: `Tracked: ${tracked.join(', ')}`,
        why:
          'If this has ever been pushed, treat every key in it as compromised. Scrapers find committed credentials ' +
          'within minutes, and deleting the file afterwards does not help because the history still holds it.',
        fix:
          'ROTATE every key in that file at the provider FIRST. Then: git rm --cached <file>, add it to .gitignore, ' +
          'commit. Purging history is a separate job and does not substitute for rotating.',
      };
    },
  },
  {
    id: 'sec.env-perms',
    axis: 'security',
    scope: 'any',
    probes: ['file-perms'],
    evaluate: (d) => {
      const files = (d['file-perms']!['files'] as Record<string, unknown>[]) ?? [];
      const bad = files.filter((f) => bool(f['groupOrOtherReadable']));
      if (bad.length === 0) return null;
      return {
        id: 'sec.env-perms',
        axis: 'security',
        severity: 'medium',
        title: 'Environment file readable beyond its owner',
        detail: bad.map((f) => `${str(f['file'])} is ${str(f['mode'])}`).join('; '),
        why: 'Any other account on the host can read the signing secret and every stored credential.',
        fix: `chmod 600 ${bad.map((f) => str(f['file'])).join(' ')}`,
      };
    },
  },
  {
    id: 'sec.datastore-exposed',
    axis: 'security',
    scope: 'any',
    probes: ['service-binding'],
    evaluate: (d) => {
      const s = d['service-binding']!;
      const exposed: string[] = [];
      if (!bool(s['databaseLoopback'])) exposed.push(`PostgreSQL at ${str(s['databaseHost'])}`);
      if (!bool(s['redisLoopback'])) exposed.push(`Redis at ${str(s['redisHost'])}`);
      if (exposed.length === 0) return null;
      return {
        id: 'sec.datastore-exposed',
        axis: 'security',
        severity: 'high',
        title: 'Datastore reached over a non-loopback address',
        detail: exposed.join('; '),
        why:
          'A datastore on a routable address is reachable by anything that can route to it. Redis in particular ' +
          'has no authentication by default.',
        fix: 'Bind Postgres and Redis to 127.0.0.1, or put them on a private network with the firewall closed to the public interface.',
      };
    },
  },
  {
    id: 'sec.prod-node-env',
    axis: 'security',
    scope: 'deployed',
    probes: ['node-process'],
    evaluate: (d) => {
      const envName = str(d['node-process']!['nodeEnv']);
      if (envName === 'production') return null;
      return {
        id: 'sec.prod-node-env',
        axis: 'security',
        severity: 'high',
        title: 'NODE_ENV is not "production" on a deployed host',
        detail: `NODE_ENV is "${envName}".`,
        why: 'Development mode leaks stack traces to clients and disables framework optimisations.',
        fix: 'Set NODE_ENV=production and restart.',
      };
    },
  },
  {
    id: 'sec.headers',
    axis: 'security',
    scope: 'any',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      const missing: string[] = [];
      if (!h['xContentTypeOptions']) missing.push('X-Content-Type-Options');
      if (!h['referrerPolicy']) missing.push('Referrer-Policy');
      if (!h['csp']) missing.push('Content-Security-Policy');
      if (!h['xFrameOptions']) missing.push('X-Frame-Options');
      if (missing.length === 0) return null;
      return {
        id: 'sec.headers',
        axis: 'security',
        severity: missing.includes('Content-Security-Policy') ? 'medium' : 'low',
        title: 'Security response headers missing',
        detail: `Not present on GET /: ${missing.join(', ')}.`,
        why:
          'X-Content-Type-Options stops MIME sniffing, X-Frame-Options stops clickjacking, and a CSP is the main ' +
          'defence against injected script on the storefront.',
        fix:
          'Add to the nginx server block:\n\n' +
          '  add_header X-Content-Type-Options nosniff always;\n' +
          '  add_header X-Frame-Options SAMEORIGIN always;\n' +
          '  add_header Referrer-Policy strict-origin-when-cross-origin always;\n\n' +
          'Build the CSP last and test it on the storefront — a wrong one breaks the page.',
      };
    },
  },
  {
    id: 'sec.powered-by',
    axis: 'security',
    scope: 'any',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      if (!h['poweredBy']) return null;
      return {
        id: 'sec.powered-by',
        axis: 'security',
        severity: 'low',
        title: 'X-Powered-By header is exposed',
        detail: `X-Powered-By: ${str(h['poweredBy'])}`,
        why: 'Advertises the framework and version, which narrows an attacker\'s search for a known CVE.',
        fix: 'Remove the header at the proxy: proxy_hide_header X-Powered-By;',
      };
    },
  },
  {
    id: 'sec.hsts',
    axis: 'security',
    scope: 'deployed',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      if (h['hsts']) return null;
      return {
        id: 'sec.hsts',
        axis: 'security',
        severity: 'medium',
        title: 'HSTS not set',
        detail: 'No Strict-Transport-Security header on GET /.',
        why: 'Without HSTS a first visit over http can be intercepted and downgraded before the redirect to https.',
        fix: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;  — only once https is confirmed working, because it is sticky in browsers.',
      };
    },
  },
  {
    id: 'sec.ssh-root',
    axis: 'security',
    scope: 'deployed',
    probes: ['ssh-config'],
    evaluate: (d) => {
      const s = d['ssh-config']!;
      if (!bool(s['available'])) return null;
      const root = str(s['permitRootLogin']);
      if (root === '' || root === 'no' || root === 'prohibit-password' || root === 'without-password') return null;
      return {
        id: 'sec.ssh-root',
        axis: 'security',
        severity: 'high',
        title: 'SSH permits root login',
        detail: `PermitRootLogin ${root}`,
        why: 'Root is the one username every bot already knows, so it removes the guesswork from a brute-force attempt.',
        fix: 'Set PermitRootLogin no in /etc/ssh/sshd_config, confirm your non-root sudo account works FIRST, then systemctl reload ssh.',
      };
    },
  },
  {
    id: 'sec.ssh-password',
    axis: 'security',
    scope: 'deployed',
    probes: ['ssh-config'],
    evaluate: (d) => {
      const s = d['ssh-config']!;
      if (!bool(s['available'])) return null;
      if (str(s['passwordAuthentication']) !== 'yes') return null;
      return {
        id: 'sec.ssh-password',
        axis: 'security',
        severity: 'high',
        title: 'SSH accepts password authentication',
        detail: 'PasswordAuthentication yes',
        why: 'Passwords can be guessed at scale; keys cannot.',
        fix: 'Install your public key, verify key login works in a SECOND session, then set PasswordAuthentication no and reload ssh.',
      };
    },
  },
  {
    id: 'sec.firewall',
    axis: 'security',
    scope: 'deployed',
    probes: ['firewall'],
    evaluate: (d) => {
      const f = d['firewall']!;
      if (bool(f['available']) && bool(f['active'])) return null;
      return {
        id: 'sec.firewall',
        axis: 'security',
        severity: 'high',
        title: 'No active firewall',
        detail: bool(f['available']) ? `${str(f['tool'])} is installed but inactive.` : 'Neither ufw nor nftables found.',
        why: 'Every listening service is reachable from the internet, including ones bound unintentionally.',
        fix: 'ufw default deny incoming; ufw allow OpenSSH; ufw allow 80,443/tcp; ufw enable  — allow SSH before enabling, or you lock yourself out.',
      };
    },
  },
  {
    id: 'sec.exposed-ports',
    axis: 'security',
    scope: 'deployed',
    probes: ['listening-ports'],
    evaluate: (d) => {
      const p = d['listening-ports']!;
      if (!bool(p['available'])) return null;
      const listeners = (p['listeners'] as Record<string, unknown>[]) ?? [];
      const expected = new Set([80, 443, 22]);
      const exposed = listeners.filter((l) => bool(l['worldReachable']) && !expected.has(num(l['port'])));
      if (exposed.length === 0) return null;
      return {
        id: 'sec.exposed-ports',
        axis: 'security',
        severity: 'high',
        title: 'Unexpected services listening on all interfaces',
        detail: `Ports ${exposed.map((l) => num(l['port'])).join(', ')} are bound to 0.0.0.0.`,
        why: 'Anything beyond 80, 443 and SSH on a public interface is usually an accident — a database or an app port that was meant to stay local.',
        fix: 'Bind each to 127.0.0.1, or close the port at the firewall if it must stay bound.',
      };
    },
  },
  {
    id: 'sec.updates',
    axis: 'security',
    scope: 'deployed',
    probes: ['pending-updates'],
    evaluate: (d) => {
      const u = d['pending-updates']!;
      if (!bool(u['available'])) return null;
      const sec = num(u['security']);
      if (sec === 0) return null;
      return {
        id: 'sec.updates',
        axis: 'security',
        severity: sec > 5 ? 'high' : 'medium',
        title: 'Pending security updates',
        detail: `${sec} security update${sec === 1 ? '' : 's'} of ${num(u['total'])} total.`,
        why: 'Published vulnerabilities are scanned for automatically; unpatched packages are found quickly.',
        fix: 'apt-get update && apt-get upgrade  — then enable unattended-upgrades so this stops accumulating.',
      };
    },
  },
  {
    id: 'sec.tls-expiry',
    axis: 'security',
    scope: 'deployed',
    probes: ['tls'],
    evaluate: (d) => {
      const t = d['tls']!;
      if (!bool(t['available'])) return null;
      const certs = (t['certificates'] as Record<string, unknown>[]) ?? [];
      const soon = certs.filter((c) => typeof c['daysRemaining'] === 'number' && num(c['daysRemaining']) < 21);
      if (soon.length === 0) return null;
      const worst = Math.min(...soon.map((c) => num(c['daysRemaining'])));
      return {
        id: 'sec.tls-expiry',
        axis: 'security',
        severity: worst < 7 ? 'critical' : 'high',
        title: 'TLS certificate expiring',
        detail: soon.map((c) => `${str(c['path'])}: ${num(c['daysRemaining'])} days`).join('; '),
        why: 'An expired certificate takes the whole site down with a browser interstitial — there is no partial failure.',
        fix: 'certbot renew --dry-run to confirm renewal works, then check the renewal timer is enabled.',
      };
    },
  },
];

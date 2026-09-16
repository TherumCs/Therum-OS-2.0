// One-time, GATED data migration for multi-email login. Run on the box AFTER
// deploying the login rewire, in the SAME watched window:
//   node --env-file=.env scripts/multiEmailBackfill.mjs
// (1) a verified kind='email' identity for every customer's primary address,
// (2) meta.altEmails folded in as UNVERIFIED (cannot log in until re-verified),
// (3) re-key every kind='password' identity subject -> customerId so the one
//     shared credential is reached by customer, not by the entered email.
// Collision-safe (never steals an address already owned elsewhere) + idempotent.
import { db } from '../dist/lib/db.js';
const norm = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

const customers = await db.customer.findMany({ select: { id: true, email: true, meta: true } });
let primaryRows = 0, altRows = 0, rekeyed = 0;
const collisions = [];
for (const c of customers) {
  const primary = norm(c.email);
  if (isEmail(primary)) {
    const owner = await db.customerIdentity.findFirst({ where: { kind: 'email', subject: primary }, select: { id: true, customerId: true, verifiedAt: true } });
    if (!owner) {
      try { await db.customerIdentity.create({ data: { customerId: c.id, kind: 'email', subject: primary, verifiedAt: new Date() } }); primaryRows++; }
      catch { collisions.push(`${primary} (create raced)`); }
    } else if (owner.customerId === c.id) {
      if (!owner.verifiedAt) await db.customerIdentity.update({ where: { id: owner.id }, data: { verifiedAt: new Date() } });
    } else {
      collisions.push(`${primary} — primary of customer ${c.id} but already an email identity of ${owner.customerId} (duplicate account)`);
    }
  }
  const alts = (c.meta && Array.isArray(c.meta.altEmails)) ? c.meta.altEmails : [];
  for (const a of alts) {
    const s = norm(a);
    if (!isEmail(s) || s === primary) continue;
    const taken = await db.customerIdentity.findFirst({ where: { kind: 'email', subject: s }, select: { customerId: true } });
    if (taken) { if (taken.customerId !== c.id) collisions.push(`${s} — alt of ${c.id} but owned by ${taken.customerId}`); continue; }
    try { await db.customerIdentity.create({ data: { customerId: c.id, kind: 'email', subject: s, verifiedAt: null } }); altRows++; }
    catch { collisions.push(`${s} (alt create raced)`); }
  }
}
const pws = await db.customerIdentity.findMany({ where: { kind: 'password' }, select: { id: true, customerId: true, subject: true } });
for (const p of pws) { if (p.subject !== p.customerId) { await db.customerIdentity.update({ where: { id: p.id }, data: { subject: p.customerId } }); rekeyed++; } }
console.log(JSON.stringify({ customers: customers.length, primaryRows, altRows, rekeyed, collisions }, null, 1));
process.exit(0);

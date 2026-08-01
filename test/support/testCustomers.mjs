// Remove the throwaway accounts a test run registers.
//
// Several suites exercise real customer registration and sign-in, which writes
// real Customer rows. They used to be left behind: ~10 per run, 345 by the time
// anyone counted, all of them sitting in the store's customer list. @test.local
// is reserved for exactly this, so clearing the whole domain IS the cleanup —
// no heuristic, no risk to a real shopper.
//
// Anything that somehow ended up attached to an order is left alone: deleting
// it would fail the foreign key anyway, and an order with no customer is worse
// than one stray row.
import { db } from '../../dist/lib/db.js';

export async function purgeTestCustomers() {
  await db.authEvent.deleteMany({ where: { username: { endsWith: '@test.local' } } }).catch(() => {});
  await db.customer.deleteMany({ where: { email: { endsWith: '@test.local' }, orders: { none: {} } } }).catch(() => {});
}

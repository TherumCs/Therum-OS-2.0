// Restore the stock-reservation invariant after a test file has finished.
//
// `reserved` is incremented when an order is created and released only by a
// real status transition (confirm, cancel, fail). Tests routinely DELETE their
// orders instead — which is fine for the rows, but leaves the count behind. It
// accumulates across runs until `inventory - reserved` no longer covers a
// single unit, and then a later run fails with 409 Insufficient stock on a test
// that has nothing to do with inventory. That was the whole "the suite cannot
// run twice in a row" problem.
//
// This does not paper over a product bug: the invariant it writes is exactly
// what order.service.ts maintains — reserved equals what pending orders hold.
import { db } from '../../dist/lib/db.js';

export async function recomputeReservations() {
  await db.$executeRawUnsafe(`
    UPDATE product_variants v
    SET reserved = COALESCE((
      SELECT SUM(oi.quantity)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.variant_id = v.id AND o.status = 'pending'
    ), 0)
  `);
}

-- One shipment per (order, tracking number): the Counter markShipped flow and the
-- wooCompat partner tracking-note handler both materialize a ship event, and a
-- concurrent/retried POST created a duplicate shipment row + duplicate "shipped"
-- email for the same parcel (audit C11). Nulls are distinct in a Postgres unique
-- index, so multiple planned (untracked) shipments per order remain allowed;
-- only a duplicate real tracking number is rejected. IF NOT EXISTS = no-op on an
-- already-patched DB. (Any pre-existing exact duplicates must be de-duped first;
-- on this store none are expected.)
CREATE UNIQUE INDEX IF NOT EXISTS "order_shipments_order_id_tracking_number_key" ON "order_shipments"("order_id", "tracking_number");

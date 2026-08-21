-- CreateIndex
CREATE INDEX "admin_users_role_id_idx" ON "admin_users"("role_id");

-- CreateIndex
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_order_id_idx" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupons_milieu_id_idx" ON "coupons"("milieu_id");

-- CreateIndex
CREATE INDEX "customer_offers_coupon_id_idx" ON "customer_offers"("coupon_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE INDEX "product_reviews_customer_id_idx" ON "product_reviews"("customer_id");

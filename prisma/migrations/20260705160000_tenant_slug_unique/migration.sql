-- Two LIVE clients must never share a tenant (review finding).
CREATE UNIQUE INDEX "Client_tenantSlug_key" ON "Client"("tenantSlug");

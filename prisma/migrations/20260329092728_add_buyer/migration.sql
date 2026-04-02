-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buyers_tenant_id_idx" ON "buyers"("tenant_id");

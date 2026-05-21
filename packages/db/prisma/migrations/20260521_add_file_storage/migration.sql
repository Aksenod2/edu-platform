-- CreateTable
CREATE TABLE "FileStorage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileStorage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileStorage_key_key" ON "FileStorage"("key");

-- CreateIndex
CREATE INDEX "FileStorage_key_idx" ON "FileStorage"("key");

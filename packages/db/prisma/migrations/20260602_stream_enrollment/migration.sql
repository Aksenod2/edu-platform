-- CreateTable
CREATE TABLE "StreamEnrollment" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamEnrollment_streamId_userId_key" ON "StreamEnrollment"("streamId", "userId");

-- CreateIndex
CREATE INDEX "StreamEnrollment_streamId_idx" ON "StreamEnrollment"("streamId");

-- CreateIndex
CREATE INDEX "StreamEnrollment_userId_idx" ON "StreamEnrollment"("userId");

-- AddForeignKey
ALTER TABLE "StreamEnrollment" ADD CONSTRAINT "StreamEnrollment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamEnrollment" ADD CONSTRAINT "StreamEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ZoomIntegration" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "accountId" TEXT,
    "clientId" TEXT,
    "clientSecretEnc" TEXT,
    "autoCreateMeeting" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoomIntegration_pkey" PRIMARY KEY ("id")
);

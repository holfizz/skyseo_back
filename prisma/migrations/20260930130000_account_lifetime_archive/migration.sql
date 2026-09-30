-- CreateTable
CREATE TABLE "workspace_account_history" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" INTEGER NOT NULL,
    "replies" INTEGER NOT NULL,

    CONSTRAINT "workspace_account_history_pkey" PRIMARY KEY ("id")
);


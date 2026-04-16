-- CreateTable
CREATE TABLE "position_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "yandexPosition" INTEGER,
    "googlePosition" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "position_history_taskId_date_idx" ON "position_history"("taskId", "date");

-- AddForeignKey
ALTER TABLE "position_history" ADD CONSTRAINT "position_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

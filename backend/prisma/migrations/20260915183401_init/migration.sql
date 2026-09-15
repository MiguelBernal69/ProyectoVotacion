-- CreateTable
CREATE TABLE "poll_results" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "poll_results_pollId_key" ON "poll_results"("pollId");

-- AddForeignKey
ALTER TABLE "poll_results" ADD CONSTRAINT "poll_results_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_results" ADD CONSTRAINT "poll_results_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

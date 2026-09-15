-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activeSessionId" TEXT,
ADD COLUMN     "lastActiveAt" TIMESTAMP(3);

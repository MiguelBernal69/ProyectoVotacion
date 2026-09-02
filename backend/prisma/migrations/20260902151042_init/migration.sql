-- CreateTable
CREATE TABLE "health_checks" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_checks_pkey" PRIMARY KEY ("id")
);

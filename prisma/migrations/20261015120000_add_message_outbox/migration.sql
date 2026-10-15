-- CreateEnum
CREATE TYPE "MessageEventType" AS ENUM ('MESSAGE_CREATED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED');

-- CreateTable
CREATE TABLE "message_outbox" (
    "id" BIGSERIAL NOT NULL,
    "type" "MessageEventType" NOT NULL,
    "message_id" TEXT NOT NULL,
    "meta" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_outbox_next_attempt_at_idx" ON "message_outbox"("next_attempt_at");

CREATE TABLE "message_push_outbox" (
    "message_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    CONSTRAINT "message_push_outbox_pkey" PRIMARY KEY ("message_id")
);

CREATE INDEX "message_push_outbox_completed_at_next_attempt_at_idx"
    ON "message_push_outbox"("completed_at", "next_attempt_at");
CREATE INDEX "message_push_outbox_expires_at_idx" ON "message_push_outbox"("expires_at");

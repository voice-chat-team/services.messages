ALTER TABLE "messages" ADD COLUMN "reactions_version" INTEGER NOT NULL DEFAULT 0;
ALTER TYPE "MessageEventType" ADD VALUE 'MESSAGE_REACTION_UPDATED';
CREATE TABLE "message_reactions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message_id" TEXT NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");
CREATE INDEX "message_reactions_message_id_emoji_created_at_id_idx" ON "message_reactions"("message_id", "emoji", "created_at", "id");

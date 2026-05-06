-- CreateTable
CREATE TABLE "mutual_follows" (
    "id" SERIAL NOT NULL,
    "target_account" TEXT NOT NULL,
    "target_name" TEXT,
    "target_profile_url" TEXT,
    "target_bio" TEXT,
    "follower_account" TEXT NOT NULL,
    "follower_name" TEXT,
    "source_id" INTEGER,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mutual_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mutual_follows_target_account_last_seen_at_idx" ON "mutual_follows"("target_account", "last_seen_at");

-- CreateIndex
CREATE INDEX "mutual_follows_source_id_idx" ON "mutual_follows"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "mutual_follows_target_account_follower_account_key" ON "mutual_follows"("target_account", "follower_account");

-- AddForeignKey
ALTER TABLE "mutual_follows" ADD CONSTRAINT "mutual_follows_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

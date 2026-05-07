-- AlterTable
ALTER TABLE "monitor_sources" ADD COLUMN     "remote_watch_error" TEXT,
ADD COLUMN     "remote_watch_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "remote_watch_synced_at" TIMESTAMP(3);

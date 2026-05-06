-- CreateTable
CREATE TABLE "monitor_sources" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "normalized_target" TEXT NOT NULL,
    "config_json" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" SERIAL NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "username" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "destination_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER,
    "event_type" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "raw_json" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_logs" (
    "id" SERIAL NOT NULL,
    "event_log_id" INTEGER,
    "destination_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitor_sources_type_normalized_target_key" ON "monitor_sources"("type", "normalized_target");

-- CreateIndex
CREATE UNIQUE INDEX "destinations_telegram_chat_id_key" ON "destinations"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_source_id_destination_id_key" ON "subscriptions"("source_id", "destination_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_logs_dedupe_key_key" ON "event_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "event_logs_source_id_received_at_idx" ON "event_logs"("source_id", "received_at");

-- CreateIndex
CREATE INDEX "delivery_logs_destination_id_sent_at_idx" ON "delivery_logs"("destination_id", "sent_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitor_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_event_log_id_fkey" FOREIGN KEY ("event_log_id") REFERENCES "event_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

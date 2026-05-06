-- CreateIndex
CREATE INDEX "delivery_logs_event_log_id_idx" ON "delivery_logs"("event_log_id");

-- CreateIndex
CREATE INDEX "subscriptions_destination_id_idx" ON "subscriptions"("destination_id");

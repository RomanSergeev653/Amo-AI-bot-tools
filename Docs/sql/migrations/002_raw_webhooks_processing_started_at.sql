-- Обычно не нужно: процессор при старте сам делает ADD COLUMN IF NOT EXISTS.
-- Ручной запуск с хоста, если нужно без поднятого processor:
-- docker exec -i amo_postgres psql -U amoadmin -d amocrm < sql/migrations/002_raw_webhooks_processing_started_at.sql

ALTER TABLE raw_webhooks ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_raw_webhooks_processing_stale
    ON raw_webhooks (processing_started_at)
    WHERE process_status = 'processing';

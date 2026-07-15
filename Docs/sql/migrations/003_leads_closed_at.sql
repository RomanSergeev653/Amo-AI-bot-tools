-- Дата закрытия сделки (amo API: closed_at, unix timestamp).
-- Обычно не нужно: processor при upsert_lead сам делает ADD COLUMN IF NOT EXISTS.
-- Ручной запуск с хоста:
--   docker exec -i amo_postgres psql -U amoadmin -d amocrm < sql/migrations/003_leads_closed_at.sql

ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_closed_at ON leads (closed_at)
    WHERE closed_at IS NOT NULL;

-- Бэкфилл из raw для строк, загруженных до поддержки closed_at в upsert_lead
UPDATE leads
SET closed_at = to_timestamp((raw->>'closed_at')::bigint)
WHERE closed_at IS NULL
  AND raw->>'closed_at' IS NOT NULL
  AND raw->>'closed_at' ~ '^\d+$'
  AND (raw->>'closed_at')::bigint > 0;

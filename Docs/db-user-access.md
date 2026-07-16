# Ограничение пользователя БД для OpenClaw-плагина

Плагин подключается к **уже существующей** PostgreSQL под логином из `.env` / config.  
Он **не** создаёт роли, **не** делает `GRANT`/`REVOKE` и **не** включает RLS.

Чтобы чувствительные данные не попадали в контекст модели, ограничивайте права **на стороне PostgreSQL**. Модель может запросить только то, что роль реально видит.

> Главный принцип: отдельная read-only роль только для бота; синхронизация amoCRM → БД пусть работает под другим пользователем.

---

## 1. Создать роль

Подключитесь админом (пример: БД `amocrm`):

```bash
psql -U amoadmin -d amocrm -h 127.0.0.1
```

```sql
CREATE ROLE amocrm_openclaw LOGIN PASSWORD 'ЗАМЕНИТЕ_НА_НАДЁЖНЫЙ_ПАРОЛЬ';

GRANT CONNECT ON DATABASE amocrm TO amocrm_openclaw;
GRANT USAGE ON SCHEMA public TO amocrm_openclaw;

-- на старте ничего не светить
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM amocrm_openclaw;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM amocrm_openclaw;
```

Имя роли можно другое — тогда же укажите его в `AMOCRM_DB_USER` плагина.

---

## 2. Выдать минимальный SELECT (пример)

Ниже — типовой набор для аналитики сделок/воронок **без** «сырого» JSON и с контролем телефонов через RLS.

Подстройте под свои нужды: что не нужно боту — **не выдавайте**.

```sql
-- Справочники воронок
GRANT SELECT ON TABLE pipelines, stages, lead_contacts TO amocrm_openclaw;

-- Сделки: без raw
GRANT SELECT (
  id, name, status_id, pipeline_id, company_id, main_contact_id,
  price, responsible_user_id, closed_at, created_at, updated_at, is_deleted
) ON TABLE leads TO amocrm_openclaw;

-- Контакты: без raw
GRANT SELECT (
  id, name, linked_company_id, company_id, responsible_user_id,
  created_at, updated_at, is_deleted
) ON TABLE contacts TO amocrm_openclaw;

-- Компании: без raw
GRANT SELECT (
  id, name, responsible_user_id, created_at, updated_at, is_deleted
) ON TABLE companies TO amocrm_openclaw;

-- Менеджеры (уберите email, если нельзя)
GRANT SELECT (
  id, name, email, department_name, is_active, created_at, updated_at
) ON TABLE amo_users TO amocrm_openclaw;

-- Задачи: без text / result_text / raw, если тексты чувствительны
GRANT SELECT (
  id, entity_type, entity_id, task_type, status, complete_till,
  responsible_user_id, created_at, updated_at, is_deleted
) ON TABLE tasks TO amocrm_openclaw;

-- Примечания: без text / raw
GRANT SELECT (
  id, entity_type, entity_id, note_type, created_by, created_at, updated_at
) ON TABLE notes TO amocrm_openclaw;

-- События: без payload
GRANT SELECT (
  id, entity_type, entity_id, action, event_time, ingested_at
) ON TABLE events TO amocrm_openclaw;

-- Справочник кастомных полей (метаданные)
GRANT SELECT ON TABLE custom_fields TO amocrm_openclaw;

-- Служебные таблицы синхронизации — НЕ выдавать:
-- raw_webhooks, sync_state
```

Права на **колонки**: `SELECT *` упадёт, если в таблице есть колонки без `GRANT` — для бота это нормально.

---

## 3. Скрыть телефоны / отдельные custom fields (RLS)

Значения полей лежат в `custom_field_values` (`custom_field_id` + `value_text` / `value_json`).  
Ограничение «по столбцу» здесь не подходит — нужны **строки**.

Пример: запретить поля с id **851323** и **851325** (подставьте свои id при необходимости):

```sql
ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_values FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amocrm_openclaw_hide_sensitive_cf ON custom_field_values;

CREATE POLICY amocrm_openclaw_hide_sensitive_cf ON custom_field_values
  FOR SELECT
  TO amocrm_openclaw
  USING (custom_field_id NOT IN (851323, 851325));

GRANT SELECT ON TABLE custom_field_values TO amocrm_openclaw;
```

Если кастомные значения боту **вообще** не нужны:

```sql
REVOKE SELECT ON TABLE custom_field_values FROM amocrm_openclaw;
-- RLS тогда не обязателен
```

Проверка под ролью бота:

```sql
-- psql -U amocrm_openclaw -d amocrm
SELECT COUNT(*) FROM custom_field_values
WHERE custom_field_id IN (851323, 851325);
-- ожидается 0 при RLS

SELECT raw FROM leads LIMIT 1;
-- ожидается permission denied
```

---

## 4. Подключить роль к плагину

В каталоге плагина (`.env` или `./scripts/install.sh`):

```env
AMOCRM_DB_USER=amocrm_openclaw
AMOCRM_DB_PASSWORD=...
# остальные AMOCRM_DB_* как обычно
```

```bash
npm run check-connection
openclaw gateway restart
```

Если пароль продублирован в `~/.openclaw/openclaw.json` → `plugins.entries.amocrm-readonly-sql.config` — обновите и там.

---

## 5. Шпаргалка: как лишать бота областей данных

| Цель | Действие |
|------|----------|
| Убрать таблицу | `REVOKE SELECT ON TABLE notes FROM amocrm_openclaw;` |
| Убрать столбцы | Заново выдать только белый список `GRANT SELECT (col1, col2, …)` или `REVOKE SELECT (text, raw) ON TABLE …` |
| Скрыть ещё одно custom field | Добавить id в `NOT IN (851323, 851325, НОВЫЙ_ID)` и пересоздать policy |
| Убрать все custom values | `REVOKE SELECT ON custom_field_values FROM amocrm_openclaw;` |
| Убрать «сырой» JSON | Не выдавать колонки `raw` / `payload` |

После изменений прав:

```bash
npm run check-connection   # в каталоге плагина
# gateway restart обычно не обязателен для PG, но сбрасывает пулы соединений
openclaw gateway restart
```

Проверка в боте: вопрос вроде «найди телефон клиента …» не должен возвращать номера из закрытых полей.

---

## 6. Что плагин уже режет сам (дополнение, не замена ACL)

- только `SELECT` / `WITH … SELECT`;
- блок `raw_webhooks`, `sync_state`;
- read-only транзакция, лимиты строк/размера.

Это **не** заменяет PostgreSQL ACL/RLS. Промпт модели тоже не заменяет.

---

## 7. Типичные чувствительные зоны в этой схеме

| Область | Где лежит | Как закрыть |
|---------|-----------|-------------|
| Телефоны / отдельные CF | `custom_field_values` по `custom_field_id` | RLS или `REVOKE` на таблицу |
| Полный объект amo | колонки `raw`, `payload` | не давать column `GRANT` |
| Тексты переписки/заметок | `notes.text`, `tasks.text` | не включать в `GRANT` |
| Email менеджеров | `amo_users.email` | убрать из column `GRANT` |
| Служебное | `raw_webhooks`, `sync_state` | не выдавать `SELECT` |

Узнать id чувствительных полей:

```sql
SELECT id, entity_type, name, code
FROM custom_fields
WHERE is_active
ORDER BY id;
```

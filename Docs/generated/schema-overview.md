# Обзор схемы amoCRM (для OpenClaw / LLM)

База — зеркало amoCRM в PostgreSQL. Плагин только читает данные; PostgreSQL уже существует.

Схема по умолчанию: `public`. Служебные таблицы `raw_webhooks` и `sync_state` **нельзя** запрашивать через tool.

## Основные таблицы

| Таблица | Назначение |
|--------|------------|
| `leads` | Сделки |
| `pipelines` | Воронки |
| `stages` | Этапы воронки (имя статуса внутри pipeline) |
| `contacts` | Контакты |
| `companies` | Компании |
| `amo_users` | Пользователи (менеджеры) amoCRM |
| `tasks` | Задачи (привязка через `entity_type` + `entity_id`) |
| `notes` | Примечания |
| `events` | События |
| `custom_fields` | Справочник пользовательских полей |
| `custom_field_values` | Значения пользовательских полей |
| `lead_contacts` | Связь сделка ↔ контакт |

## Связи

```text
pipelines 1───* stages (pipeline_id, status_id)
leads.pipeline_id → pipelines.id
leads.status_id   → stages.status_id (в паре с pipeline_id)
leads.company_id  → companies.id
leads.main_contact_id → contacts.id
leads.responsible_user_id → amo_users.id

lead_contacts: lead_id ↔ contact_id (is_main)

contacts.company_id / linked_company_id → companies.id
contacts.responsible_user_id → amo_users.id

tasks / notes / events:
  entity_type = 'leads' | 'contacts' | 'companies' | ...
  entity_id   = id сущности

custom_field_values:
  (entity_type, entity_id, custom_field_id) → custom_fields (id, entity_type)
```

Жёстких FK в SQL может не быть — связывайте по id как выше.

## Как найти сделки контакта

```sql
SELECT l.id, l.name, l.price, l.status_id, l.pipeline_id, l.updated_at
FROM lead_contacts lc
JOIN leads l ON l.id = lc.lead_id
WHERE lc.contact_id = 123
  AND l.is_deleted = FALSE
ORDER BY l.updated_at DESC
LIMIT 10;
```

Главный контакт сделки также в `leads.main_contact_id`.

## Как найти задачи сделки

```sql
SELECT id, text, status, complete_till, responsible_user_id
FROM tasks
WHERE entity_type = 'leads'
  AND entity_id = 456
  AND is_deleted = FALSE
ORDER BY complete_till NULLS LAST
LIMIT 10;
```

## Ответственный

`leads.responsible_user_id` → `amo_users.id` (`name`, `email`, `is_active`).

## Воронка и статус

```sql
SELECT l.id, l.name, p.name AS pipeline, s.name AS stage, l.status_id
FROM leads l
LEFT JOIN pipelines p ON p.id = l.pipeline_id
LEFT JOIN stages s
  ON s.pipeline_id = l.pipeline_id AND s.status_id = l.status_id
WHERE l.id = 456;
```

## Активные / успешные / проигранные

В amoCRM по умолчанию:

| Состояние | Правило |
|-----------|---------|
| Успех (won) | `status_id = 142` |
| Проигрыш (lost) | `status_id = 143` |
| Активные | `is_deleted = FALSE` и `status_id NOT IN (142, 143)` |

Имена этапов лучше брать из `stages.name` для конкретной воронки. Дата закрытия: `leads.closed_at`.

Пример активных:

```sql
SELECT COUNT(*) AS count
FROM leads
WHERE is_deleted = FALSE
  AND status_id NOT IN (142, 143);
```

## Телефон / email

В `contacts` нет отдельных колонок телефона. Ищите через `custom_fields` / `custom_field_values` (и при необходимости `raw` JSONB), например по `custom_fields.code` или `name`.

## Ловушки (часто)

- У `stages` **нет** `id`. PK: `(pipeline_id, status_id)`.
- Join этапа: `s.pipeline_id = l.pipeline_id AND s.status_id = l.status_id`.
- Won/lost: `status_id` 142 / 143.
- Телефон/email — через `custom_fields` / `custom_field_values`.
- Не запрашивать `raw_webhooks`, `sync_state`.

Tool `get_amocrm_schema` возвращает тот же словарь колонок/join’ов без данных клиентов.

## Даты и идентификаторы

- Id сущностей — `BIGINT` (как в amoCRM).
- Даты — `TIMESTAMPTZ` (`created_at`, `updated_at`, `closed_at`, `complete_till`).
- Мягкое удаление: `is_deleted` у leads/contacts/companies/tasks.
- Деньги: `leads.price` — `NUMERIC(18,2)`.

## Правила объёма для tool

1. Сначала агрегаты (`COUNT`, `SUM`, …).
2. Не `SELECT *`.
3. Списки — обычно `LIMIT 10` (или `max_rows` tool; жёсткий потолок на сервере).
4. Не выгружать целые таблицы.
5. Персональные данные — только если нужны для ответа.

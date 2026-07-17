# amoCRM Read-only SQL + F5AI agent

Два режима:

1. **OpenClaw plugin** — tool `query_amocrm_database` / `get_amocrm_schema` внутри существующего OpenClaw.
2. **Standalone agent** — модель через [F5AI](https://f5ai.ru/api), tools те же, общение через **Telegram** или CLI. OpenClaw не нужен.

> **Проект не создаёт, не запускает и не обслуживает PostgreSQL.**  
> Он только подключается к уже существующей базе по указанным доступам.

Подробно про standalone: **[Docs/f5ai-telegram-agent.md](Docs/f5ai-telegram-agent.md)**.  
Права роли БД: **[Docs/db-user-access.md](Docs/db-user-access.md)**.

## Что это даёт

Один основной tool: `query_amocrm_database` — модель формирует SQL, сервис проверяет его и выполняет только чтение.

Вспомогательный tool: `get_amocrm_schema` — статическая схема таблиц/колонок/join’ов без данных клиентов.

Примеры вопросов: число активных сделок, сделки без задач, продажи за период, поиск контакта, просроченные задачи и т.д.

## Требования

- Node.js **20+** (на хосте OpenClaw лучше **22+**, как требует OpenClaw 2026.6.x)
- Доступ к существующей PostgreSQL с данными amoCRM
- OpenClaw **>= 2026.5.17** на сервере (для установки plugin)
- Желательно отдельный **read-only** пользователь БД (создаётся админом вручную) — см. [ограничение доступа пользователя БД](Docs/db-user-access.md)
- Для standalone: токен [F5AI API](https://f5ai.ru/api) и (опционально) Telegram bot token

## Быстрый старт: F5AI + Telegram (без OpenClaw)

```bash
cp .env.example .env
# заполните F5AI_API_KEY, AMOCRM_DB_*, TELEGRAM_BOT_TOKEN

npm install
npm run probe:f5ai    # проверка API
npm run cli:chat      # чат в терминале
npm run telegram      # бот в Telegram
```

См. [Docs/f5ai-telegram-agent.md](Docs/f5ai-telegram-agent.md).

## Структура

```text
.
├── Docs/
│   ├── sql/                 # описание схемы (не менять)
│   ├── db-user-access.md    # права роли БД для бота (ACL / RLS)
│   ├── f5ai-telegram-agent.md
│   └── generated/
│       └── schema-overview.md
├── src/
│   ├── agent/               # цикл агента (F5AI + tools)
│   ├── f5ai/                # HTTP-клиент api.f5ai.ru
│   ├── config/              # .env / plugin config
│   ├── db/                  # пул PostgreSQL, read-only транзакции
│   ├── security/            # SQL-валидатор
│   ├── schema/              # словарь схемы для LLM
│   ├── tools/               # query service
│   └── index.ts             # OpenClaw defineToolPlugin (опционально)
├── scripts/
│   ├── install.sh           # интерактивная настройка доступов к БД
│   ├── check-connection.ts
│   ├── probe-f5ai.ts
│   ├── cli-chat.ts
│   └── telegram-bot.ts
├── tests/
├── .env.example
├── openclaw.plugin.json
└── package.json
```

## Установка OpenClaw plugin (опционально)

### 1. Скопировать проект на сервер

Например:

```bash
scp -r ./ "root@YOUR_HOST:/opt/openclaw-amocrm-readonly-sql"
ssh root@YOUR_HOST
cd /opt/openclaw-amocrm-readonly-sql
```

### 2. Запустить install-скрипт

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

Скрипт запросит:

| Переменная | Смысл |
|------------|--------|
| `AMOCRM_DB_HOST` | хост PostgreSQL |
| `AMOCRM_DB_PORT` | порт (по умолчанию `5432`) |
| `AMOCRM_DB_NAME` | имя базы |
| `AMOCRM_DB_USER` | пользователь |
| `AMOCRM_DB_PASSWORD` | пароль (без эха) |
| `AMOCRM_DB_SSLMODE` | `prefer` по умолчанию |

Затем:

1. `npm install`
2. сохранит `.env` (права `600`, пароль не печатает)
3. проверит `SELECT 1` и чтение основных таблиц
4. соберёт TypeScript / metadata plugin (если есть `openclaw` в PATH)

Install **не** ставит PostgreSQL, не создаёт БД/таблицы, не делает `CREATE USER` / `GRANT` / миграции.

### 3. Зарегистрировать plugin в OpenClaw (вручную)

```bash
cd /opt/openclaw-amocrm-readonly-sql
npm run plugin:build          # если ещё не собрали
openclaw plugins install --link /opt/openclaw-amocrm-readonly-sql
openclaw plugins enable amocrm-readonly-sql
openclaw gateway restart
openclaw plugins inspect amocrm-readonly-sql --runtime
```

Альтернатива без `--link`:

```bash
openclaw plugins install /opt/openclaw-amocrm-readonly-sql
```

### 4. Конфиг доступов

По умолчанию plugin читает `AMOCRM_DB_*` из `.env` рядом с пакетом / из окружения процесса gateway.

Можно продублировать в `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "amocrm-readonly-sql": {
        "enabled": true,
        "config": {
          "host": "127.0.0.1",
          "port": 5432,
          "database": "amocrm",
          "user": "readonly_user",
          "password": "...",
          "sslmode": "prefer"
        }
      }
    }
  }
}
```

После смены доступов: обновите `.env` или config и перезапустите gateway. Проверка без бота:

```bash
npm run check-connection
```

## Пример вызова tool

```json
{
  "sql": "SELECT COUNT(*) AS count FROM leads WHERE is_deleted = FALSE AND status_id NOT IN (142, 143)",
  "purpose": "Посчитать активные сделки"
}
```

Успешный ответ (схематично):

```json
{
  "success": true,
  "columns": ["count"],
  "rows": [{ "count": 37 }],
  "row_count": 1,
  "truncated": false,
  "execution_time_ms": 24
}
```

Ошибка:

```json
{
  "success": false,
  "error_type": "query_rejected",
  "message": "Разрешены только SELECT-запросы (включая WITH ... SELECT)"
}
```

## Безопасность

Программные проверки (не только промпт):

- только один statement: `SELECT` / `WITH ... SELECT`
- запрет `INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/...`
- запрет нескольких команд, `SET`, опасных функций (`pg_read_file`, `dblink`, …)
- запрет `raw_webhooks`, `sync_state`, чужих схем (`information_schema`, …)
- выполнение в `BEGIN READ ONLY` + `statement_timeout`
- жёсткий лимит строк (по умолчанию max **100**, default **10**)
- лимит размера ответа (~100 KB) и длины SQL
- пароль не пишется в логи tool-ответов

## Лимиты по умолчанию

| Параметр | Значение |
|----------|----------|
| `statement_timeout` | 10_000 ms |
| default rows | 10 |
| hard max rows | 100 |
| max result | 102_400 bytes |
| max SQL length | 10_000 |
| schema | `public` |

Переопределение: env `AMOCRM_DB_*` или plugin config.

## Удаление

```bash
openclaw plugins disable amocrm-readonly-sql
openclaw plugins uninstall amocrm-readonly-sql
# опционально удалить каталог пакета и .env
```

## Рекомендация админу БД (вручную)

Плагин **не** создаёт роли и **не** меняет `GRANT`/`REVOKE`/RLS.

Полная инструкция: **[Docs/db-user-access.md](Docs/db-user-access.md)** — создание роли `amocrm_openclaw`, column-level `SELECT`, скрытие custom fields (например id `851323`, `851325`) через RLS, шпаргалка как забирать права.

Кратко:

1. Отдельная LOGIN-роль только для плагина.
2. Выдать минимальный `SELECT` (лучше без колонок `raw` / `payload`).
3. Чувствительные строки в `custom_field_values` — через RLS или вообще без `SELECT` на таблицу.
4. Прописать роль в `.env` плагина → `npm run check-connection` → restart gateway.

## Разработка / тесты

```bash
npm install
npm test
npm run build
```

На машине с OpenClaw CLI:

```bash
npm run plugin:build
npm run plugin:validate
```

## Известные ограничения

- Валидатор — эвристический (не полный SQL AST); опасные конструкции блокируются, но экзотический SQL может быть отклонён «с запасом».
- Нет отдельного tool на каждый тип вопроса — один универсальный SQL.
- Имена кастомных полей (телефон/email) зависят от аккаунта amoCRM.
- Статусы 142/143 — стандарт amoCRM; уточняйте имена этапов через `stages`.
- Локальная сборка без установленного `openclaw` использует type shim; финальный `plugins build/validate` — на сервере с OpenClaw.
- Если gateway ругается на `Cannot find package 'openclaw'`, в каталоге плагина выполните `npm install /usr/lib/node_modules/openclaw` (или путь к вашему global openclaw) и перезапустите gateway.
- Doctor-предупреждения OpenClaw про другие plugins (например codex) к этому пакету не относятся.

## Лицензия / секретность

Не коммитьте `.env`. Не публикуйте пароли и gateway/Telegram tokens в чатах и репозитории.

Ограничение данных для модели на уровне PostgreSQL: [Docs/db-user-access.md](Docs/db-user-access.md).

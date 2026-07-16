# amoCRM Read-only SQL (OpenClaw plugin)

Универсальный **read-only** tool для существующего OpenClaw: безопасные `SELECT` к уже работающей PostgreSQL-базе amoCRM.

> **Проект не создаёт, не запускает и не обслуживает PostgreSQL.**  
> Он только подключается к уже существующей базе по указанным доступам.

## Что это даёт боту

Один основной tool: `query_amocrm_database` — модель формирует SQL, tool проверяет его и выполняет только чтение.

Вспомогательный tool: `get_amocrm_schema` — статическая схема таблиц/колонок/join’ов без данных клиентов (чтобы меньше ошибаться в SQL).

Примеры вопросов: число активных сделок, сделки без задач, продажи за период, поиск контакта, просроченные задачи и т.д.

## Требования

- Node.js **20+** (на хосте OpenClaw лучше **22+**, как требует OpenClaw 2026.6.x)
- Доступ к существующей PostgreSQL с данными amoCRM
- OpenClaw **>= 2026.5.17** на сервере (для установки plugin)
- Желательно отдельный **read-only** пользователь БД (создаётся админом вручную)

## Структура

```text
.
├── Docs/
│   ├── sql/                 # описание схемы (не менять)
│   └── generated/
│       └── schema-overview.md
├── src/
│   ├── config/              # .env / plugin config
│   ├── db/                  # пул PostgreSQL, read-only транзакции
│   ├── security/            # SQL-валидатор
│   ├── tools/               # query service
│   └── index.ts             # OpenClaw defineToolPlugin
├── scripts/
│   ├── install.sh           # интерактивная настройка доступов
│   └── check-connection.ts
├── tests/
├── .env.example
├── openclaw.plugin.json
└── package.json
```

## Установка на сервере OpenClaw

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

Создайте read-only роль сами (плагин этого **не** делает):

```sql
CREATE ROLE amocrm_readonly LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE amocrm TO amocrm_readonly;
GRANT USAGE ON SCHEMA public TO amocrm_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO amocrm_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO amocrm_readonly;
```

При желании отзовите `SELECT` на `raw_webhooks` / `sync_state`.

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

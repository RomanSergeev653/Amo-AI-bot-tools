# Standalone agent: F5AI + Telegram + amoCRM tools

Без OpenClaw. Модель «думает» через [F5AI API](https://f5ai.ru/api), tools — read-only SQL к PostgreSQL amoCRM, общение — Telegram (или CLI).

```text
Telegram / CLI
      ↓
scripts/telegram-bot.ts  или  scripts/cli-chat.ts
      ↓
agent loop  →  api.f5ai.ru/v2/chat/completions
      ↓
tools: get_amocrm_schema, query_amocrm_database
      ↓
PostgreSQL (read-only роль, см. db-user-access.md)
```

## Env

Скопируйте `.env.example` → `.env`:

| Переменная | Назначение |
|------------|------------|
| `F5AI_API_KEY` | токен из кабинета F5AI (заголовок `X-Auth-Token`) |
| `F5AI_BASE_URL` | по умолчанию `https://api.f5ai.ru` |
| `F5AI_MODEL` | например `gpt-4o` (см. модели в кабинете) |
| `TELEGRAM_BOT_TOKEN` | токен BotFather |
| `TELEGRAM_ALLOW_FROM` | опционально: id пользователей через запятую |
| `AMOCRM_DB_*` | доступы к существующей БД |

## Команды

```bash
npm install

# проверка API F5AI (нужен F5AI_API_KEY)
npm run probe:f5ai

# чат в терминале (нужны F5AI + желательно AMOCRM_DB_*)
npm run cli:chat

# Telegram-бот
npm run telegram
```

Ответы в Telegram уходят с `parse_mode=HTML`. Правила разметки для модели — `TELEGRAM_FORMATTING_RULES` в `src/agent/loop.ts` (жирный/курсив/`code`, без Markdown). Если HTML битый — бот шлёт plaintext fallback.

## Права БД

Тот же контур, что для OpenClaw-плагина: [db-user-access.md](./db-user-access.md).

## OpenClaw

Опциональный entry `src/index.ts` (plugin) можно не использовать на клиентских серверах — достаточно `telegram` / `cli:chat`.

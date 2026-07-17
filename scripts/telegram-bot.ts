#!/usr/bin/env npx tsx
/**
 * Telegram bot: F5AI agent + amoCRM read-only tools.
 * Replies use Telegram HTML parse_mode (see TELEGRAM_FORMATTING_RULES).
 * While working, shows a monospace status log that is deleted before the answer.
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { Bot, type Context } from "grammy";
import { loadF5aiConfigFromEnv, type ChatMessage } from "../src/f5ai/client.js";
import {
  buildTelegramSystemPrompt,
  runAgentTurn,
  trimHistory,
} from "../src/agent/loop.js";

loadDotenv({ path: resolve(process.cwd(), ".env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

/** Max lines in the live status <pre> block (older lines drop). */
const STATUS_MAX_LINES = 12;
/** Soft char cap for Telegram (message limit 4096). */
const STATUS_MAX_CHARS = 3500;

const allowFrom = (process.env.TELEGRAM_ALLOW_FROM ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sessions = new Map<string, ChatMessage[]>();
const systemPrompt = buildTelegramSystemPrompt();

function isAllowed(userId: number | undefined): boolean {
  if (allowFrom.length === 0) return true;
  if (userId === undefined) return false;
  return allowFrom.includes(String(userId));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Strip tags for plain fallback if HTML parse fails. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function formatStatusPre(lines: string[]): string {
  let kept = lines.slice(-STATUS_MAX_LINES);
  let body = kept.join("\n");
  while (body.length > STATUS_MAX_CHARS && kept.length > 1) {
    kept = kept.slice(1);
    body = kept.join("\n");
  }
  if (body.length > STATUS_MAX_CHARS) {
    body = `…${body.slice(-(STATUS_MAX_CHARS - 1))}`;
  }
  return `<pre>${escapeHtml(body)}</pre>`;
}

async function replyFormatted(ctx: Context, text: string): Promise<void> {
  const body = text.slice(0, 4000);
  try {
    await ctx.reply(body, { parse_mode: "HTML" });
  } catch {
    await ctx.reply(stripHtml(body).slice(0, 4000));
  }
}

type StatusLog = {
  messageId: number;
  lines: string[];
};

async function pushStatus(
  ctx: Context,
  status: StatusLog,
  line: string,
): Promise<void> {
  const cleaned = line.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!cleaned) return;
  // Skip exact duplicate of the previous line
  if (status.lines[status.lines.length - 1] === cleaned) return;
  status.lines.push(cleaned);
  const html = formatStatusPre(status.lines);
  try {
    await ctx.api.editMessageText(ctx.chat!.id, status.messageId, html, {
      parse_mode: "HTML",
    });
  } catch {
    /* ignore edit races / unchanged content */
  }
}

async function main(): Promise<void> {
  const f5ai = loadF5aiConfigFromEnv();
  const bot = new Bot(token!);

  bot.command("start", async (ctx) => {
    await replyFormatted(
      ctx,
      "Привет. Я помощник по <b>amoCRM</b> (F5AI + read-only SQL).\n/reset — очистить историю диалога.",
    );
  });

  bot.command("reset", async (ctx) => {
    const key = String(ctx.chat?.id ?? ctx.from?.id);
    sessions.delete(key);
    await ctx.reply("История очищена.");
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) {
      await ctx.reply("Доступ запрещён.");
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    const key = String(ctx.chat?.id ?? userId);
    const history = sessions.get(key) ?? [];

    const statusMsg = await ctx.reply(formatStatusPre(["думаю…"]), {
      parse_mode: "HTML",
    });
    const status: StatusLog = {
      messageId: statusMsg.message_id,
      lines: ["думаю…"],
    };

    try {
      const result = await runAgentTurn(history, text, {
        f5ai,
        systemPrompt,
        onToolStart: async (name, purpose) => {
          const label = purpose?.trim() || name;
          await pushStatus(ctx, status, `→ ${label}`);
        },
      });

      sessions.set(key, trimHistory(result.messages));

      try {
        await ctx.api.deleteMessage(ctx.chat.id, status.messageId);
      } catch {
        /* ignore */
      }

      await replyFormatted(ctx, result.reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await ctx.api.deleteMessage(ctx.chat.id, status.messageId);
      } catch {
        /* ignore */
      }
      await ctx.reply(`Ошибка: ${msg.slice(0, 500)}`);
    }
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  console.log(`Telegram bot starting (model=${f5ai.model})…`);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

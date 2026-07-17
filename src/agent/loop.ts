import {
  F5aiClient,
  type ChatMessage,
  type F5aiConfig,
} from "../f5ai/client.js";
import { executeAgentTool, getAgentToolDefinitions } from "./tools.js";

export const DEFAULT_SYSTEM_PROMPT = `Ты — помощник по аналитике amoCRM. Отвечай по-русски, кратко и по делу.

Перед SQL:
1. Если не уверен в колонках/join — вызови get_amocrm_schema.
2. Не показывай SQL. Прогресс инструментов пользователь уже видит отдельно — в финальном ответе сразу дай результат.
3. Используй только SELECT. Не выдумывай колонки: у stages нет id (PK: pipeline_id + status_id).
4. Активные сделки: is_deleted=FALSE AND status_id NOT IN (142,143). Успех=142, проигрыш=143. Конверсия обычно: won / (won+lost) или won / все закрытые — уточняй формулу кратко в ответе.
5. Не запрашивай сырые JSON (raw/payload) и служебные таблицы.
6. Персональные данные (телефоны и т.п.) — только если явно нужны и доступны; иначе опирайся на агрегаты.
7. Лимит строк по умолчанию = 10. Если пользователь просит «все» (воронки, этапы, пользователи и т.п.) — передай max_rows=100 (или сначала COUNT(*), потом выборка с достаточным max_rows). Не утверждай, что список полный, если в ответе инструмента truncated=true или строк ровно 10 без COUNT.
8. Имена воронок/этапов/пользователей ищи гибко: ILIKE '%фрагмент%' (у имён часто точка/инициалы, напр. «Сергеев Р.»). Если 0 строк — не делай вывод «данных нет», сначала проверь похожие названия через pipelines/stages.

Когда вызываешь инструменты, дождись их результата в следующем сообщении пользователя (блок «Результат инструмента») и только потом дай финальный ответ.`;

/** Extra rules when the channel is Telegram (parse_mode=HTML). */
export const TELEGRAM_FORMATTING_RULES = `Канал: Telegram. Форматируй финальный ответ только в HTML (parse_mode=HTML), не Markdown.

Разрешённые теги:
- <b>…</b> — жирный (заголовки, ключевые цифры)
- <i>…</i> — курсив (пояснения, формула)
- <code>…</code> — короткие значения/id
- <pre>…</pre> — только если нужен многострочный блок (редко)
- <a href="https://…">текст</a> — ссылки при необходимости
Теги должны быть корректно закрыты и могут быть вложенными по правилам Telegram.

Экранирование в обычном тексте (вне тегов):
- & → &amp;
- < → &lt;
- > → &gt;

Запрещено:
- Markdown: **, *, _, \`, #, списки с -, «\`\`\`»
- HTML-теги вне списка выше (<p>, <br>, <div>, <ul>, …)
- Показывать SQL

Структура ответа:
1. Первая строка — краткий итог в <b>…</b>
2. Дальше список или 2–4 коротких пункта
3. Цифры и % выделяй <b>…</b>
4. Если пунктов много (>15) — сначала итог/топ, затем «всего N»`;

export function buildTelegramSystemPrompt(
  base: string = DEFAULT_SYSTEM_PROMPT,
): string {
  return `${base}\n\n${TELEGRAM_FORMATTING_RULES}`;
}

export type AgentRunOptions = {
  f5ai: F5aiConfig;
  systemPrompt?: string;
  maxToolRounds?: number;
  /** Called when the model starts a tool (for Telegram progress). */
  onToolStart?: (name: string, purpose?: string) => void | Promise<void>;
};

export type AgentRunResult = {
  reply: string;
  messages: ChatMessage[];
  toolRounds: number;
};

export async function runAgentTurn(
  history: ChatMessage[],
  userText: string,
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  const client = new F5aiClient(options.f5ai);
  const tools = getAgentToolDefinitions();
  const maxRounds = options.maxToolRounds ?? 8;

  // Working transcript for the model (system + history + user).
  // Tool results are injected as user messages (F5AI-native tool role is unreliable).
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    },
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: userText },
  ];

  // Public history returned to caller (no system prompt).
  const publicHistory: ChatMessage[] = [
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: userText },
  ];

  let toolRounds = 0;
  let lastToolHadResults = false;

  for (let round = 0; round < maxRounds; round += 1) {
    const completion = await client.chatCompletions({
      messages,
      tools,
      tool_choice: "auto",
    });

    const assistant = completion.message;
    const calls = (assistant.tool_calls ?? []).filter((c) => c.function.name);
    const finish = (completion.finishReason ?? "").toUpperCase();
    const looksLikeToolFinish =
      finish.includes("TOOL") || finish === "TOOL_CALL" || finish === "TOOL_CALLS";

    if (calls.length === 0) {
      const reply = (assistant.content ?? "").trim();

      // After tools: reject empty / "calling tools…" echoes as a fake final answer.
      if (
        lastToolHadResults &&
        (looksLikeToolFinish || isToolAnnouncement(reply) || !reply)
      ) {
        messages.push({
          role: "user",
          content:
            "Инструменты уже выполнены выше. Дай финальный ответ пользователю по их результатам (цифры/список). Не пиши, что вызываешь инструмент, если не передаёшь новый tool call.",
        });
        continue;
      }

      // Before any tools: model said it will call tools but sent no tool_calls.
      if (!lastToolHadResults && (looksLikeToolFinish || isToolAnnouncement(reply))) {
        messages.push({
          role: "assistant",
          content: reply || "Нужны данные из CRM.",
        });
        messages.push({
          role: "user",
          content:
            "Вызови нужный инструмент через tool call (query_amocrm_database / get_amocrm_schema), не ограничивайся текстом «вызываю».",
        });
        continue;
      }

      const finalReply = reply || "(пустой ответ модели)";
      publicHistory.push({ role: "assistant", content: finalReply });
      return { reply: finalReply, messages: publicHistory, toolRounds };
    }

    toolRounds += 1;
    lastToolHadResults = true;

    // Progress for the user goes through onToolStart only — do not put synthetic
    // "calling tools" text into publicHistory (it was shown as a fake final reply).
    const assistantNote =
      (assistant.content ?? "").trim() && !isToolAnnouncement(assistant.content ?? "")
        ? (assistant.content ?? "").trim()
        : null;
    if (assistantNote) {
      messages.push({ role: "assistant", content: assistantNote });
    } else {
      messages.push({
        role: "assistant",
        content: `Запрашиваю данные через ${calls.map((c) => c.function.name).join(", ")}.`,
      });
    }

    const resultBlocks: string[] = [];

    for (const call of calls) {
      let purpose: string | undefined;
      try {
        const parsed = JSON.parse(call.function.arguments || "{}") as {
          purpose?: string;
        };
        purpose = parsed.purpose;
      } catch {
        /* ignore */
      }

      await options.onToolStart?.(call.function.name, purpose);

      const executed = await executeAgentTool(
        call.function.name,
        call.function.arguments,
      );

      resultBlocks.push(
        `Результат инструмента ${call.function.name}:\n${JSON.stringify(executed.result)}`,
      );
    }

    const toolUserMsg = `${resultBlocks.join("\n\n")}\n\nИспользуй эти результаты и дай финальный ответ на исходный вопрос пользователя (с цифрами). Если данных мало — снова вызови инструмент с конкретным SQL. Не отвечай фразой «вызываю инструмент» без нового tool call.`;
    messages.push({ role: "user", content: toolUserMsg });
  }

  const fallback =
    "Достигнут лимит шагов с инструментами. Уточните вопрос или упростите задачу.";
  publicHistory.push({ role: "assistant", content: fallback });
  return { reply: fallback, messages: publicHistory, toolRounds };
}

function isToolAnnouncement(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    t.startsWith("вызываю инструмент") ||
    t.startsWith("вызову инструмент") ||
    t.startsWith("сейчас вызову") ||
    /^calling tool/.test(t)
  );
}

/** Keep only recent turns to bound context size. */
export function trimHistory(
  history: ChatMessage[],
  maxMessages = 40,
): ChatMessage[] {
  if (history.length <= maxMessages) return history;
  return history.slice(-maxMessages);
}

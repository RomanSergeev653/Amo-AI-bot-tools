#!/usr/bin/env npx tsx
/**
 * Interactive CLI chat with F5AI + amoCRM tools (no Telegram).
 */
import { config as loadDotenv } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { loadF5aiConfigFromEnv, type ChatMessage } from "../src/f5ai/client.js";
import { runAgentTurn, trimHistory } from "../src/agent/loop.js";

loadDotenv({ path: resolve(process.cwd(), ".env") });

async function main(): Promise<void> {
  const f5ai = loadF5aiConfigFromEnv();
  console.log(`F5AI model=${f5ai.model} base=${f5ai.baseUrl}`);
  console.log("CLI chat. Пустая строка /exit — выход.\n");

  const rl = createInterface({ input, output });
  let history: ChatMessage[] = [];

  while (true) {
    const line = (await rl.question("Вы: ")).trim();
    if (!line || line === "/exit" || line === "/quit") break;

    try {
      const result = await runAgentTurn(history, line, {
        f5ai,
        onToolStart: (name, purpose) => {
          console.log(`  → tool ${name}${purpose ? `: ${purpose}` : ""}`);
        },
      });
      history = trimHistory(result.messages);
      console.log(`Бот: ${result.reply}\n`);
    } catch (err) {
      console.error(
        "Ошибка:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

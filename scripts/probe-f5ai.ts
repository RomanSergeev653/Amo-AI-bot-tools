#!/usr/bin/env npx tsx
/**
 * Probe F5AI API: models list + simple chat (+ optional tools).
 * Requires F5AI_API_KEY in env or .env
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import {
  F5aiClient,
  loadF5aiConfigFromEnv,
} from "../src/f5ai/client.js";
import { getAgentToolDefinitions } from "../src/agent/tools.js";

loadDotenv({ path: resolve(process.cwd(), ".env") });

async function main(): Promise<void> {
  const cfg = loadF5aiConfigFromEnv();
  const client = new F5aiClient(cfg);

  console.log(`Base: ${cfg.baseUrl}`);
  console.log(`Model: ${cfg.model}`);
  console.log("Fetching /v2/models ...");

  try {
    const models = await client.listModels();
    const preview = JSON.stringify(models).slice(0, 800);
    console.log("Models OK:", preview);
  } catch (err) {
    console.error("Models failed:", err instanceof Error ? err.message : err);
  }

  console.log("\nSimple chat ...");
  try {
    const chat = await client.chatCompletions({
      messages: [
        { role: "user", content: "Ответь одним словом: работает?" },
      ],
      max_tokens: 32,
    });
    console.log("Chat OK:", chat.message.content);
    console.log("Raw keys:", Object.keys((chat.raw as object) ?? {}));
  } catch (err) {
    console.error("Chat failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  console.log("\nChat with tools schema (may or may not call tools) ...");
  try {
    const withTools = await client.chatCompletions({
      messages: [
        {
          role: "system",
          content: "If you need schema, call get_amocrm_schema. Else say OK.",
        },
        {
          role: "user",
          content: "Просто скажи OK, tools вызывать не обязательно.",
        },
      ],
      tools: getAgentToolDefinitions(),
      tool_choice: "auto",
      max_tokens: 64,
    });
    console.log("Content:", withTools.message.content);
    console.log(
      "Tool calls:",
      JSON.stringify(withTools.message.tool_calls ?? null),
    );
  } catch (err) {
    console.error(
      "Tools chat failed (model may not support tools):",
      err instanceof Error ? err.message : err,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

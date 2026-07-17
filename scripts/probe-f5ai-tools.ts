import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const key = process.env.F5AI_API_KEY!;
const base = process.env.F5AI_BASE_URL || "https://api.f5ai.ru";
const model = process.env.F5AI_MODEL || "gpt-4o";

async function post(label: string, body: unknown): Promise<void> {
  const res = await fetch(`${base}/v2/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n=== ${label} HTTP ${res.status} ===`);
  console.log(text.slice(0, 800));
}

async function main(): Promise<void> {
  const messages = [{ role: "user", content: "Скажи OK" }];

  await post("A openai tools", {
    model,
    messages,
    tools: [
      {
        type: "function",
        function: {
          name: "ping",
          description: "Ping",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: "auto",
  });

  await post("B flat name on tool", {
    model,
    messages,
    tools: [
      {
        type: "function",
        name: "ping",
        description: "Ping",
        parameters: { type: "object", properties: {} },
      },
    ],
  });

  await post("C legacy functions", {
    model,
    messages,
    functions: [
      {
        name: "ping",
        description: "Ping",
        parameters: { type: "object", properties: {} },
      },
    ],
  });

  await post("D tools name-only objects", {
    model,
    messages,
    tools: [
      {
        name: "ping",
        description: "Ping",
        parameters: { type: "object", properties: {} },
      },
    ],
  });

  await post("E tools as string names", {
    model,
    messages,
    tools: ["ping"],
  });

  const mres = await fetch(`${base}/v2/models`, {
    headers: { "X-Auth-Token": key, Authorization: `Bearer ${key}` },
  });
  const models = (await mres.json()) as Record<
    string,
    { type?: string; available?: boolean; function_calling?: boolean; code?: string }
  >;
  const llm = Object.values(models).filter(
    (m) => m && m.type === "llm" && m.available && m.function_calling,
  );
  console.log(
    "\nAvailable LLM with function_calling:",
    llm.map((m) => m.code).slice(0, 40),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

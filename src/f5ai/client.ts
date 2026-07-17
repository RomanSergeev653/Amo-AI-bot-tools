/**
 * F5AI chat client.
 * Docs: https://f5ai.ru/api — base https://api.f5ai.ru, header X-Auth-Token
 *
 * Quirks vs OpenAI:
 * - Request tools are FLAT: { type, name, description, parameters } (not nested under function)
 * - Response uses `tools_calls` with { id, name, arguments } (arguments may be object/array)
 * - Native tool-result round-trip (role:tool) is unreliable across providers on F5AI;
 *   the agent loop injects tool results as user messages instead.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/** OpenAI-shaped definition used inside our codebase. */
export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type F5aiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

export type ChatCompletionRequest = {
  model?: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
};

export type ChatCompletionResult = {
  message: ChatMessage;
  raw: unknown;
  usage?: unknown;
  finishReason?: string;
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Convert OpenAI nested tools → F5AI flat tools. */
export function toF5aiTools(tools: ChatToolDefinition[]): Record<string, unknown>[] {
  return tools.map((t) => {
    const params = ensureObjectParameters(t.function.parameters);
    return {
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: params,
    };
  });
}

/**
 * F5AI/OpenAI reject empty properties objects that get coerced to [].
 * Ensure parameters is always a proper JSON Schema object.
 */
function ensureObjectParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const props = parameters.properties;
  if (
    parameters.type === "object" &&
    (props === undefined ||
      (typeof props === "object" &&
        props !== null &&
        !Array.isArray(props) &&
        Object.keys(props as object).length === 0))
  ) {
    return {
      ...parameters,
      type: "object",
      properties: {
        _unused: {
          type: "boolean",
          description: "Unused placeholder so the schema stays a non-empty object",
        },
      },
    };
  }
  return parameters;
}

/** Messages sent to F5AI: drop internal-only fields that confuse the gateway. */
function toF5aiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = {
      role: m.role,
      content: m.content ?? "",
    };
    if (m.name) out.name = m.name;
    // Do not forward tool_calls / tool_call_id — F5AI round-trip is broken;
    // agent uses user-injected tool results instead.
    return out;
  });
}

export class F5aiClient {
  constructor(private readonly config: F5aiConfig) {}

  async listModels(): Promise<unknown> {
    return this.request("GET", "/v2/models");
  }

  async chatCompletions(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      messages: toF5aiMessages(req.messages),
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = toF5aiTools(req.tools);
      if (req.tool_choice) body.tool_choice = req.tool_choice;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;

    const raw = await this.request("POST", "/v2/chat/completions", body);
    const obj = raw as Record<string, unknown>;
    return {
      message: extractAssistantMessage(raw),
      raw,
      usage: obj.usage,
      finishReason:
        typeof obj.finish_reason === "string" ? obj.finish_reason : undefined,
    };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = this.config.timeoutMs ?? 120_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(joinUrl(this.config.baseUrl, path), {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": this.config.apiKey,
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw_text: text };
      }

      if (!res.ok) {
        const msg =
          typeof json === "object" &&
          json !== null &&
          "error" in json &&
          typeof (json as { error?: { message?: string } }).error?.message ===
            "string"
            ? (json as { error: { message: string } }).error.message
            : text.slice(0, 500);
        throw new Error(`F5AI HTTP ${res.status}: ${msg}`);
      }

      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function extractAssistantMessage(raw: unknown): ChatMessage {
  if (!raw || typeof raw !== "object") {
    throw new Error("Empty F5AI response");
  }

  const obj = raw as Record<string, unknown>;
  let msgObj: Record<string, unknown> | undefined;

  if (obj.message && typeof obj.message === "object") {
    msgObj = obj.message as Record<string, unknown>;
  } else if (Array.isArray(obj.choices) && obj.choices[0]) {
    const choice = obj.choices[0] as { message?: Record<string, unknown> };
    msgObj = choice.message;
  }

  if (!msgObj) {
    throw new Error(
      `Unexpected F5AI chat response shape: ${JSON.stringify(raw).slice(0, 400)}`,
    );
  }

  const content =
    msgObj.content === null || msgObj.content === undefined
      ? null
      : String(msgObj.content);

  const tool_calls = normalizeToolCalls(obj, msgObj);

  return {
    role: "assistant",
    content,
    ...(tool_calls.length > 0 ? { tool_calls } : {}),
  };
}

function normalizeToolCalls(
  root: Record<string, unknown>,
  msg: Record<string, unknown>,
): ToolCall[] {
  const candidates = [root.tools_calls, root.tool_calls, msg.tools_calls, msg.tool_calls];

  for (const raw of candidates) {
    if (!Array.isArray(raw) || raw.length === 0) continue;
    return raw.map((item, i) => {
      const t = item as Record<string, unknown>;
      // Flat F5AI: { id, name, arguments }
      if (typeof t.name === "string") {
        return {
          id: String(t.id ?? `call_${i}`),
          type: "function" as const,
          function: {
            name: t.name,
            arguments: stringifyArgs(t.arguments),
          },
        };
      }
      // OpenAI nested: { id, function: { name, arguments } }
      const fn = (t.function ?? {}) as Record<string, unknown>;
      return {
        id: String(t.id ?? `call_${i}`),
        type: "function" as const,
        function: {
          name: String(fn.name ?? ""),
          arguments: stringifyArgs(fn.arguments),
        },
      };
    });
  }

  return [];
}

function stringifyArgs(args: unknown): string {
  if (typeof args === "string") return args;
  if (args === undefined || args === null) return "{}";
  if (Array.isArray(args)) {
    // F5AI sometimes returns [] for empty args
    return "{}";
  }
  if (typeof args === "object") {
    // Normalize empty-string optional fields
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (v === "") continue;
      cleaned[k] = v;
    }
    return JSON.stringify(cleaned);
  }
  return "{}";
}

export function loadF5aiConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): F5aiConfig {
  const apiKey = env.F5AI_API_KEY ?? env.F5AI_TOKEN ?? "";
  if (!apiKey) {
    throw new Error("F5AI_API_KEY is not set");
  }
  return {
    apiKey,
    baseUrl: env.F5AI_BASE_URL ?? "https://api.f5ai.ru",
    model: env.F5AI_MODEL ?? "gpt-4o",
    timeoutMs: env.F5AI_TIMEOUT_MS
      ? Number.parseInt(env.F5AI_TIMEOUT_MS, 10)
      : 120_000,
  };
}

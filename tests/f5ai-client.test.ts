import { describe, expect, it } from "vitest";
import {
  extractAssistantMessage,
  toF5aiTools,
  type ChatToolDefinition,
} from "../src/f5ai/client.js";

describe("extractAssistantMessage", () => {
  it("parses F5AI quickstart shape", () => {
    const msg = extractAssistantMessage({
      message: { role: "assistant", content: "Привет" },
    });
    expect(msg.content).toBe("Привет");
  });

  it("parses F5AI tools_calls flat shape", () => {
    const msg = extractAssistantMessage({
      message: { role: "assistant", content: null },
      tools_calls: [
        {
          id: "c1",
          name: "get_amocrm_schema",
          arguments: { table: "" },
        },
      ],
      finish_reason: "TOOL_CALL",
    });
    expect(msg.tool_calls?.[0]?.function.name).toBe("get_amocrm_schema");
    expect(msg.tool_calls?.[0]?.function.arguments).toBe("{}");
  });

  it("parses OpenAI choices shape", () => {
    const msg = extractAssistantMessage({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "get_amocrm_schema", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });
    expect(msg.tool_calls?.[0]?.function.name).toBe("get_amocrm_schema");
  });
});

describe("toF5aiTools", () => {
  it("flattens OpenAI tool definitions", () => {
    const tools: ChatToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "ping",
          description: "Ping",
          parameters: {
            type: "object",
            properties: { x: { type: "string" } },
          },
        },
      },
    ];
    const flat = toF5aiTools(tools);
    expect(flat[0]).toMatchObject({
      type: "function",
      name: "ping",
      description: "Ping",
    });
    expect(flat[0]?.function).toBeUndefined();
  });
});

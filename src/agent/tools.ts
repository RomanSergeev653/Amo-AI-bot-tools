import { Type } from "typebox";
import { loadDbConfig } from "../config/env.js";
import {
  buildQueryToolSchemaSummary,
  getAmocrmSchemaPayload,
} from "../schema/amocrm-schema.js";
import { runReadonlyQuery } from "../tools/query-service.js";
import type { ChatToolDefinition } from "../f5ai/client.js";

export type AgentToolResult = {
  name: string;
  ok: boolean;
  result: unknown;
};

const queryParameters = {
  type: "object",
  properties: {
    sql: {
      type: "string",
      description: "A single SELECT or WITH ... SELECT statement",
    },
    purpose: {
      type: "string",
      description: "Short Russian description of the goal (not SQL)",
    },
    max_rows: {
      type: "number",
      description:
        "Max rows (default 10, hard cap usually 100). Use 100 when the user asks for a full catalog (all pipelines, stages, users, etc.).",
    },
  },
  required: ["sql", "purpose"],
  additionalProperties: false,
} as const;

const schemaParameters = {
  type: "object",
  properties: {
    table: {
      type: "string",
      description: "Optional single table name (e.g. stages, leads)",
    },
  },
  additionalProperties: false,
} as const;

export function getAgentToolDefinitions(): ChatToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "get_amocrm_schema",
        description:
          "Return static amoCRM schema: tables, columns, joins, gotchas. No customer data. Call before SQL if unsure (stages has NO id).",
        parameters: schemaParameters as unknown as Record<string, unknown>,
      },
    },
    {
      type: "function",
      function: {
        name: "query_amocrm_database",
        description: `Safe read-only SQL against amoCRM PostgreSQL mirror.

Rules: only SELECT/WITH SELECT; no SELECT *; prefer aggregates; default max_rows=10 (pass max_rows=100 for full lists like all pipelines); no raw_webhooks/sync_state; won=142 lost=143; stages PK=(pipeline_id,status_id).

${buildQueryToolSchemaSummary()}`,
        parameters: queryParameters as unknown as Record<string, unknown>,
      },
    },
  ];
}

export async function executeAgentTool(
  name: string,
  argsJson: string,
): Promise<AgentToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return {
      name,
      ok: false,
      result: { success: false, error_type: "bad_arguments", message: "Invalid JSON arguments" },
    };
  }

  try {
    if (name === "get_amocrm_schema") {
      const table = typeof args.table === "string" ? args.table : undefined;
      return { name, ok: true, result: getAmocrmSchemaPayload(table) };
    }

    if (name === "query_amocrm_database") {
      const sql = String(args.sql ?? "");
      const purpose = String(args.purpose ?? "");
      const max_rows =
        typeof args.max_rows === "number" ? args.max_rows : undefined;
      const dbConfig = loadDbConfig();
      const result = await runReadonlyQuery({ sql, purpose, max_rows }, dbConfig);
      return { name, ok: result.success === true, result };
    }

    return {
      name,
      ok: false,
      result: {
        success: false,
        error_type: "unknown_tool",
        message: `Unknown tool: ${name}`,
      },
    };
  } catch (err) {
    return {
      name,
      ok: false,
      result: {
        success: false,
        error_type: "tool_error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** Keep Type import referenced so tree-shaking does not drop typebox usage in future. */
void Type;

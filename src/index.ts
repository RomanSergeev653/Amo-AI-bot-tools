import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { loadDbConfig, type PluginDbOverrides } from "./config/env.js";
import {
  buildQueryToolSchemaSummary,
  getAmocrmSchemaPayload,
} from "./schema/amocrm-schema.js";
import { runReadonlyQuery } from "./tools/query-service.js";

const configSchema = Type.Object({
  host: Type.Optional(Type.String({ description: "PostgreSQL host" })),
  port: Type.Optional(Type.Number({ description: "PostgreSQL port (default 5432)" })),
  database: Type.Optional(Type.String({ description: "Database name" })),
  user: Type.Optional(Type.String({ description: "Database user" })),
  password: Type.Optional(Type.String({ description: "Database password" })),
  sslmode: Type.Optional(
    Type.String({
      description: "SSL mode: disable | allow | prefer | require | verify-ca | verify-full",
    }),
  ),
  statementTimeoutMs: Type.Optional(Type.Number()),
  maxRows: Type.Optional(Type.Number()),
  defaultRows: Type.Optional(Type.Number()),
  maxResultBytes: Type.Optional(Type.Number()),
  maxSqlLength: Type.Optional(Type.Number()),
  schema: Type.Optional(Type.String({ description: "Allowed schema (default public)" })),
});

type PluginConfig = {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  sslmode?: string;
  statementTimeoutMs?: number;
  maxRows?: number;
  defaultRows?: number;
  maxResultBytes?: number;
  maxSqlLength?: number;
  schema?: string;
};

const TOOL_DESCRIPTION = `Execute a safe read-only SQL query against the existing amoCRM PostgreSQL mirror.

Rules:
1. Prefer COUNT/EXISTS/SUM/AVG/MIN/MAX and GROUP BY before listing rows.
2. Never use SELECT *. Prefer preferred columns only.
3. Lists: default max_rows=10 (hard server cap still applies).
4. Never dump entire tables. Avoid personal data unless required.
5. Only SELECT / WITH ... SELECT. Schema public only.
6. Do not query raw_webhooks or sync_state.
7. Lead status: active = is_deleted=FALSE AND status_id NOT IN (142,143); won=142; lost=143.
8. If unsure about columns/joins, call get_amocrm_schema first (or after a column error).
9. Put a short Russian purpose describing the user-facing goal.

${buildQueryToolSchemaSummary()}

Example stage join:
LEFT JOIN stages s ON s.pipeline_id = l.pipeline_id AND s.status_id = l.status_id`;

function toOverrides(config: PluginConfig): PluginDbOverrides {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    sslmode: config.sslmode,
    statementTimeoutMs: config.statementTimeoutMs,
    maxRows: config.maxRows,
    defaultRows: config.defaultRows,
    maxResultBytes: config.maxResultBytes,
    maxSqlLength: config.maxSqlLength,
    schema: config.schema,
  };
}

function loadConfigOrError(config: PluginConfig) {
  try {
    return { ok: true as const, dbConfig: loadDbConfig(toOverrides(config)) };
  } catch (err) {
    return {
      ok: false as const,
      error: {
        success: false as const,
        error_type: "config_error" as const,
        message:
          err instanceof Error
            ? err.message
            : "Конфигурация БД не задана. Запустите scripts/install.sh.",
      },
    };
  }
}

export default defineToolPlugin({
  id: "amocrm-readonly-sql",
  name: "amoCRM Read-only SQL",
  description:
    "Safe read-only SQL access to an existing amoCRM PostgreSQL database. Does not create or manage PostgreSQL.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "get_amocrm_schema",
      label: "Схема amoCRM",
      description:
        "Return the static read-only schema dictionary for the amoCRM PostgreSQL mirror: tables, columns, PKs, joins, gotchas, and example SELECTs. No customer data. Call this before writing SQL if unsure about columns (especially stages: no id, use pipeline_id+status_id).",
      parameters: Type.Object({
        table: Type.Optional(
          Type.String({
            description:
              "Optional single table name to return (e.g. stages, leads). Omit for full schema.",
          }),
        ),
      }),
      execute(params) {
        const { table } = params as { table?: string };
        return getAmocrmSchemaPayload(table);
      },
    }),
    tool({
      name: "query_amocrm_database",
      label: "Запрос к базе amoCRM",
      description: TOOL_DESCRIPTION,
      parameters: Type.Object({
        sql: Type.String({
          description: "A single SELECT or WITH ... SELECT statement",
        }),
        purpose: Type.String({
          description:
            "Short Russian description of the goal shown/used as intent (not SQL)",
        }),
        max_rows: Type.Optional(
          Type.Number({
            description:
              "Max rows to return (default 10). Cannot exceed the server hard limit.",
          }),
        ),
      }),
      async execute(params, config, context) {
        const { sql, purpose, max_rows } = params as {
          sql: string;
          purpose: string;
          max_rows?: number;
        };
        context.signal?.throwIfAborted?.();

        const loaded = loadConfigOrError(config as PluginConfig);
        if (!loaded.ok) return loaded.error;

        return runReadonlyQuery({ sql, purpose, max_rows }, loaded.dbConfig);
      },
    }),
  ],
});

import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { loadDbConfig, type PluginDbOverrides } from "./config/env.js";
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

Rules for the model:
1. Prefer COUNT, EXISTS, SUM, AVG, MIN, MAX and GROUP BY before listing rows.
2. Do not fetch full entity lists when a count is enough.
3. Never use SELECT *.
4. For lists, default to at most 10 rows (pass max_rows only when needed; hard backend cap still applies).
5. For full details, first resolve a specific id.
6. Never dump an entire table.
7. Do not request personal data unless required for the answer.
8. Select only columns needed for the answer.
9. Allowed tables: leads, pipelines, stages, contacts, companies, amo_users, tasks, notes, events, custom_fields, custom_field_values, lead_contacts.
10. Do not query raw_webhooks or sync_state.
11. Lead status: active = not deleted and status_id NOT IN (142, 143); won = 142; lost = 143. Prefer joining stages for human-readable names.
12. Schema is public only. Only SELECT / WITH ... SELECT.

See Docs/generated/schema-overview.md for joins and examples.`;

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

export default defineToolPlugin({
  id: "amocrm-readonly-sql",
  name: "amoCRM Read-only SQL",
  description:
    "Safe read-only SQL access to an existing amoCRM PostgreSQL database. Does not create or manage PostgreSQL.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "query_amocrm_database",
      label: "Query amoCRM database",
      description: TOOL_DESCRIPTION,
      parameters: Type.Object({
        sql: Type.String({
          description: "A single SELECT or WITH ... SELECT statement",
        }),
        purpose: Type.String({
          description: "Short description of why this query is needed",
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

        let dbConfig;
        try {
          dbConfig = loadDbConfig(toOverrides(config as PluginConfig));
        } catch (err) {
          return {
            success: false,
            error_type: "config_error",
            message:
              err instanceof Error
                ? err.message
                : "Конфигурация БД не задана. Запустите scripts/install.sh.",
          };
        }

        return runReadonlyQuery({ sql, purpose, max_rows }, dbConfig);
      },
    }),
  ],
});

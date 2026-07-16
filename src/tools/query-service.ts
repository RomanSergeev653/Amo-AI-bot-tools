import type { DbConfig } from "../config/env.js";
import { redactSecrets } from "../config/env.js";
import { withReadonlyClient } from "../db/pool.js";
import { buildSchemaErrorHint } from "../schema/amocrm-schema.js";
import { validateReadonlySql } from "../security/sql-validator.js";

export type QuerySuccess = {
  success: true;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  execution_time_ms: number;
  purpose?: string;
};

export type QueryFailure = {
  success: false;
  error_type:
    | "query_rejected"
    | "timeout"
    | "connection_error"
    | "execution_error"
    | "result_too_large"
    | "config_error";
  message: string;
  schema_hint?: string;
};

export type QueryResult = QuerySuccess | QueryFailure;

export type RunQueryInput = {
  sql: string;
  purpose?: string;
  max_rows?: number;
};

function resolveRowLimit(requested: number | undefined, config: DbConfig): number {
  const soft = requested ?? config.defaultRows;
  const capped = Math.min(Math.max(1, soft), config.maxRows);
  return capped;
}

function wrapWithLimit(sql: string, limit: number): string {
  // Always wrap so LIMIT in user SQL cannot exceed the hard cap.
  return `SELECT * FROM (\n${sql}\n) AS _amocrm_readonly_q LIMIT ${limit}`;
}

function serializeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "bigint") {
      out[key] = value.toString();
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (Buffer.isBuffer(value)) {
      out[key] = value.toString("base64");
    } else {
      out[key] = value;
    }
  }
  return out;
}

function estimateBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function mapError(err: unknown, password: string): QueryFailure {
  const raw = err instanceof Error ? err.message : String(err);
  const message = redactSecrets(raw, password);

  if (/statement timeout|canceling statement due to statement timeout/i.test(message)) {
    return {
      success: false,
      error_type: "timeout",
      message: "Запрос превысил лимит времени выполнения",
    };
  }

  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connection refused|timeout expired|could not connect/i.test(
      message,
    )
  ) {
    return {
      success: false,
      error_type: "connection_error",
      message: "Не удалось подключиться к PostgreSQL",
    };
  }

  if (/password authentication failed|no pg_hba\.conf entry/i.test(message)) {
    return {
      success: false,
      error_type: "connection_error",
      message: "Неверные доступы к базе данных",
    };
  }

  const schemaHint = buildSchemaErrorHint(message);
  return {
    success: false,
    error_type: "execution_error",
    message: `Ошибка выполнения запроса: ${message}`,
    ...(schemaHint ? { schema_hint: schemaHint } : {}),
  };
}

/**
 * Validate and execute a read-only SQL query against the configured amoCRM DB.
 */
export async function runReadonlyQuery(
  input: RunQueryInput,
  config: DbConfig,
): Promise<QueryResult> {
  let cfg: DbConfig;
  try {
    cfg = config;
    if (!cfg.host || !cfg.database || !cfg.user) {
      throw new Error("incomplete config");
    }
  } catch {
    return {
      success: false,
      error_type: "config_error",
      message:
        "Конфигурация БД не задана. Запустите scripts/install.sh или задайте AMOCRM_DB_* / plugin config.",
    };
  }

  const validation = validateReadonlySql(input.sql, {
    maxSqlLength: cfg.maxSqlLength,
    schema: cfg.schema,
  });

  if (!validation.ok) {
    return {
      success: false,
      error_type: validation.error_type,
      message: validation.message,
    };
  }

  const rowLimit = resolveRowLimit(input.max_rows, cfg);
  const limitedSql = wrapWithLimit(validation.sql, rowLimit);
  const started = Date.now();

  try {
    const result = await withReadonlyClient(cfg, async (client) => {
      return client.query(limitedSql);
    });

    const rows = result.rows.map((row) =>
      serializeRow(row as Record<string, unknown>),
    );
    const columns = result.fields.map((f) => f.name);
    const payload = { columns, rows };
    const bytes = estimateBytes(payload);

    if (bytes > cfg.maxResultBytes) {
      return {
        success: false,
        error_type: "result_too_large",
        message: `Результат превышает лимит ${cfg.maxResultBytes} байт. Уточните SELECT или уменьшите max_rows.`,
      };
    }

    return {
      success: true,
      columns,
      rows,
      row_count: rows.length,
      truncated: rows.length >= rowLimit,
      execution_time_ms: Date.now() - started,
      ...(input.purpose ? { purpose: input.purpose } : {}),
    };
  } catch (err) {
    return mapError(err, cfg.password);
  }
}

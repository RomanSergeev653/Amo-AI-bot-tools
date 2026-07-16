import pg from "pg";
import type { DbConfig } from "../config/env.js";
import { redactSecrets } from "../config/env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let poolKey = "";

function sslOption(sslmode: string): boolean | { rejectUnauthorized: boolean } {
  const mode = sslmode.toLowerCase();
  if (mode === "disable") return false;
  if (mode === "require" || mode === "prefer" || mode === "allow") {
    return { rejectUnauthorized: false };
  }
  if (mode === "verify-full" || mode === "verify-ca") {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

function makeKey(config: DbConfig): string {
  return [
    config.host,
    config.port,
    config.database,
    config.user,
    config.sslmode,
  ].join("|");
}

export function getPool(config: DbConfig): pg.Pool {
  const key = makeKey(config);
  if (pool && poolKey === key) return pool;

  if (pool) {
    void pool.end().catch(() => undefined);
  }

  pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: sslOption(config.sslmode),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "openclaw-amocrm-readonly-sql",
  });

  pool.on("error", (err) => {
    const safe = redactSecrets(String(err.message), config.password);
    console.error(`[amocrm-readonly-sql] pool error: ${safe}`);
  });

  poolKey = key;
  return pool;
}

export async function withReadonlyClient<T>(
  config: DbConfig,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool(config).connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${config.statementTimeoutMs}`);
    await client.query(`SET LOCAL search_path TO ${quoteIdent(config.schema)}`);
    // Extra session hardening (no effect if role cannot change; ignore failures).
    try {
      await client.query("SET LOCAL default_transaction_read_only = on");
    } catch {
      /* ignore */
    }

    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid schema name: ${ident}`);
  }
  return `"${ident}"`;
}

export async function checkConnection(config: DbConfig): Promise<void> {
  await withReadonlyClient(config, async (client) => {
    await client.query("SELECT 1 AS ok");
  });
}

export async function checkReadableTables(
  config: DbConfig,
  tables: string[],
): Promise<{ table: string; ok: boolean; error?: string }[]> {
  const results: { table: string; ok: boolean; error?: string }[] = [];

  await withReadonlyClient(config, async (client) => {
    for (const table of tables) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
        results.push({ table, ok: false, error: "invalid table name" });
        continue;
      }
      const sp = `sp_${table}`;
      try {
        await client.query(`SAVEPOINT ${quoteIdent(sp)}`);
        await client.query(
          `SELECT 1 FROM ${quoteIdent(config.schema)}.${quoteIdent(table)} LIMIT 1`,
        );
        await client.query(`RELEASE SAVEPOINT ${quoteIdent(sp)}`);
        results.push({ table, ok: true });
      } catch (err) {
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${quoteIdent(sp)}`);
        } catch {
          /* ignore */
        }
        const message = redactSecrets(
          err instanceof Error ? err.message : String(err),
          config.password,
        );
        results.push({ table, ok: false, error: message });
      }
    }
  });

  return results;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    poolKey = "";
  }
}

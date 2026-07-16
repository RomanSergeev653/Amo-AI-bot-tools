import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslmode: string;
  statementTimeoutMs: number;
  maxRows: number;
  defaultRows: number;
  maxResultBytes: number;
  maxSqlLength: number;
  schema: string;
};

export type PluginDbOverrides = {
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

const DEFAULTS = {
  port: 5432,
  sslmode: "prefer",
  statementTimeoutMs: 10_000,
  maxRows: 100,
  defaultRows: 10,
  maxResultBytes: 102_400,
  maxSqlLength: 10_000,
  schema: "public",
} as const;

let dotenvLoaded = false;

function tryLoadDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, quiet: true });
      return;
    }
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

function requireEnv(name: string, override?: string): string {
  const value = override ?? process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing ${name}. Run scripts/install.sh or set environment variables / plugin config.`,
    );
  }
  return value;
}

/**
 * Load DB settings from env (.env) with optional OpenClaw plugin config overrides.
 * Password is never logged by callers — keep it out of error messages that might leak.
 */
export function loadDbConfig(overrides: PluginDbOverrides = {}): DbConfig {
  tryLoadDotenv();

  return {
    host: overrides.host ?? requireEnv("AMOCRM_DB_HOST"),
    port: overrides.port ?? envInt("AMOCRM_DB_PORT", DEFAULTS.port),
    database: overrides.database ?? requireEnv("AMOCRM_DB_NAME"),
    user: overrides.user ?? requireEnv("AMOCRM_DB_USER"),
    password: overrides.password ?? requireEnv("AMOCRM_DB_PASSWORD"),
    sslmode:
      overrides.sslmode ??
      process.env.AMOCRM_DB_SSLMODE ??
      DEFAULTS.sslmode,
    statementTimeoutMs:
      overrides.statementTimeoutMs ??
      envInt("AMOCRM_DB_STATEMENT_TIMEOUT_MS", DEFAULTS.statementTimeoutMs),
    maxRows: overrides.maxRows ?? envInt("AMOCRM_DB_MAX_ROWS", DEFAULTS.maxRows),
    defaultRows:
      overrides.defaultRows ??
      envInt("AMOCRM_DB_DEFAULT_ROWS", DEFAULTS.defaultRows),
    maxResultBytes:
      overrides.maxResultBytes ??
      envInt("AMOCRM_DB_MAX_RESULT_BYTES", DEFAULTS.maxResultBytes),
    maxSqlLength:
      overrides.maxSqlLength ??
      envInt("AMOCRM_DB_MAX_SQL_LENGTH", DEFAULTS.maxSqlLength),
    schema: overrides.schema ?? process.env.AMOCRM_DB_SCHEMA ?? DEFAULTS.schema,
  };
}

export function redactSecrets(text: string, password?: string): string {
  let out = text;
  if (password && password.length > 0) {
    out = out.split(password).join("[REDACTED]");
  }
  out = out.replace(
    /(password|passwd|pwd)\s*[=:]\s*\S+/gi,
    "$1=[REDACTED]",
  );
  out = out.replace(
    /postgresql:\/\/([^:]+):([^@]+)@/gi,
    "postgresql://$1:[REDACTED]@",
  );
  return out;
}

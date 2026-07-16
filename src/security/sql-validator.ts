export type SqlValidationOk = {
  ok: true;
  sql: string;
};

export type SqlValidationFail = {
  ok: false;
  error_type: "query_rejected";
  message: string;
};

export type SqlValidationResult = SqlValidationOk | SqlValidationFail;

export type SqlValidatorOptions = {
  maxSqlLength: number;
  schema: string;
  /** Tables that must never appear in SQL (case-insensitive). */
  blockedTables?: string[];
};

const DEFAULT_BLOCKED_TABLES = ["raw_webhooks", "sync_state"];

/** Keywords / statements that mutate data or schema. */
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "DROP",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "CALL",
  "DO",
  "VACUUM",
  "REINDEX",
  "REFRESH",
  "MERGE",
  "COMMENT",
  "SECURITY",
  "OWNER",
  "LISTEN",
  "NOTIFY",
  "UNLISTEN",
  "DISCARD",
  "LOCK",
  "REASSIGN",
  "CLUSTER",
  "CHECKPOINT",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
  "DECLARE",
  "FETCH",
  "MOVE",
  "CLOSE",
  "SET",
  "RESET",
  "SHOW",
  "LOAD",
  "IMPORT",
  "EXPORT",
] as const;

/** Dangerous PostgreSQL functions / extensions. */
const FORBIDDEN_LOCK_CLAUSES = ["FOR UPDATE", "FOR SHARE", "FOR NO KEY UPDATE", "FOR KEY SHARE"];

const FORBIDDEN_FUNCTIONS = [
  "pg_read_file",
  "pg_read_binary_file",
  "pg_write_file",
  "pg_ls_dir",
  "pg_stat_file",
  "lo_import",
  "lo_export",
  "lo_get",
  "lo_put",
  "lo_from_bytea",
  "lo_unlink",
  "dblink",
  "dblink_exec",
  "dblink_connect",
  "postgres_fdw",
  "file_fdw",
  "pg_execute_server_program",
  "pg_logfile_rotate",
  "current_setting",
  "set_config",
  "pg_sleep",
  "pg_terminate_backend",
  "pg_cancel_backend",
] as const;

function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }

    if (inDouble) {
      out += ch;
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out += ch;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inSingle) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i += 1;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function maskStringLiterals(sql: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inSingle) {
      if (ch === "'" && next === "'") {
        out += "  ";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        out += " ";
        i += 1;
        continue;
      }
      out += " ";
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        out += " ";
        i += 1;
        continue;
      }
      out += " ";
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += " ";
      i += 1;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out += " ";
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function keywordPattern(keyword: string): RegExp {
  return new RegExp(`(?:^|[^a-zA-Z0-9_])${keyword}(?:[^a-zA-Z0-9_]|$)`, "i");
}

function functionPattern(fn: string): RegExp {
  return new RegExp(`\\b${fn}\\s*\\(`, "i");
}

function isSelectish(statement: string): boolean {
  const normalized = statement.replace(/^\s*\(/, "").trimStart();
  return /^(WITH|SELECT)\b/i.test(normalized);
}

function findForbiddenKeyword(sql: string): string | null {
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (keywordPattern(kw).test(sql)) return kw;
  }
  return null;
}

function findForbiddenFunction(sql: string): string | null {
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (functionPattern(fn).test(sql)) return fn;
  }
  return null;
}

function findBlockedTable(sql: string, blocked: string[]): string | null {
  for (const table of blocked) {
    const re = new RegExp(
      `(?:^|[^a-zA-Z0-9_])(?:public\\.)?${table}(?:[^a-zA-Z0-9_]|$)`,
      "i",
    );
    if (re.test(sql)) return table;
  }
  return null;
}

function findNonPublicSchema(sql: string, allowedSchema: string): string | null {
  // Catch schema-qualified identifiers other than the allowed schema / pg_catalog in limited cases.
  // Allow: public.foo, "public".foo
  const re =
    /(?:FROM|JOIN|INTO|UPDATE|TABLE|VIEW)\s+([a-zA-Z_][\w$]*|"[^"]+")\s*\.\s*([a-zA-Z_][\w$]*|"[^"]+")/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const schema = match[1]!.replaceAll('"', "").toLowerCase();
    if (schema !== allowedSchema.toLowerCase()) {
      return schema;
    }
  }

  // Also catch bare schema.table elsewhere (SELECT schema.col is OK for table alias — harder).
  // Block known system schemas explicitly.
  const systemSchemas = ["pg_catalog", "information_schema", "pg_toast"];
  for (const schema of systemSchemas) {
    if (schema === allowedSchema.toLowerCase()) continue;
    const sysRe = new RegExp(
      `(?:^|[^a-zA-Z0-9_])${schema}\\s*\\.`,
      "i",
    );
    if (sysRe.test(sql)) return schema;
  }

  return null;
}

/**
 * Programmatic SQL gate: only a single SELECT / WITH ... SELECT against the allowed schema.
 */
export function validateReadonlySql(
  rawSql: string,
  options: SqlValidatorOptions,
): SqlValidationResult {
  if (typeof rawSql !== "string" || rawSql.trim() === "") {
    return {
      ok: false,
      error_type: "query_rejected",
      message: "SQL не должен быть пустым",
    };
  }

  if (rawSql.length > options.maxSqlLength) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: `SQL превышает максимальную длину (${options.maxSqlLength} символов)`,
    };
  }

  const withoutComments = stripSqlComments(rawSql);
  const statements = splitStatements(withoutComments);

  if (statements.length === 0) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: "SQL не должен быть пустым",
    };
  }

  if (statements.length > 1) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: "Разрешена только одна SQL-команда за вызов",
    };
  }

  const statement = statements[0]!;
  const scan = maskStringLiterals(statement);

  if (!isSelectish(statement)) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: "Разрешены только SELECT-запросы (включая WITH ... SELECT)",
    };
  }

  const forbiddenKw = findForbiddenKeyword(scan);
  if (forbiddenKw) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: `Запрещённая операция: ${forbiddenKw}`,
    };
  }

  const forbiddenFn = findForbiddenFunction(scan);
  if (forbiddenFn) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: `Запрещённая функция: ${forbiddenFn}`,
    };
  }

  for (const clause of FORBIDDEN_LOCK_CLAUSES) {
    if (new RegExp(`\\b${clause.replaceAll(" ", "\\s+")}\\b`, "i").test(scan)) {
      return {
        ok: false,
        error_type: "query_rejected",
        message: `Запрещённая конструкция: ${clause}`,
      };
    }
  }

  const blockedTables = options.blockedTables ?? DEFAULT_BLOCKED_TABLES;
  const blocked = findBlockedTable(scan, blockedTables);
  if (blocked) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: `Доступ к таблице ${blocked} запрещён`,
    };
  }

  const badSchema = findNonPublicSchema(scan, options.schema);
  if (badSchema) {
    return {
      ok: false,
      error_type: "query_rejected",
      message: `Разрешена только схема ${options.schema} (найдено обращение к ${badSchema})`,
    };
  }

  return { ok: true, sql: statement };
}

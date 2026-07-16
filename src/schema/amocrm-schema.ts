/**
 * Static schema dictionary for the amoCRM mirror.
 * Source of truth for LLM tool descriptions and column-error hints.
 * Do not invent columns: keep in sync with Docs/sql/init/001_schema.sql.
 */

export type TableSchema = {
  name: string;
  purpose: string;
  columns: { name: string; type: string; note?: string }[];
  primaryKey: string[];
  /** Columns safe to prefer in SELECT (excludes bulky raw JSON when possible). */
  preferredColumns: string[];
};

export const ALLOWED_TABLES = [
  "leads",
  "pipelines",
  "stages",
  "contacts",
  "companies",
  "amo_users",
  "tasks",
  "notes",
  "events",
  "custom_fields",
  "custom_field_values",
  "lead_contacts",
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export const TABLE_SCHEMAS: Record<AllowedTable, TableSchema> = {
  leads: {
    name: "leads",
    purpose: "Сделки",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "name",
      "pipeline_id",
      "status_id",
      "price",
      "responsible_user_id",
      "company_id",
      "main_contact_id",
      "created_at",
      "updated_at",
      "closed_at",
      "is_deleted",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "name", type: "TEXT" },
      { name: "status_id", type: "BIGINT", note: "142=won, 143=lost; join stages with pipeline_id" },
      { name: "pipeline_id", type: "BIGINT", note: "→ pipelines.id" },
      { name: "company_id", type: "BIGINT", note: "→ companies.id" },
      { name: "main_contact_id", type: "BIGINT", note: "→ contacts.id" },
      { name: "price", type: "NUMERIC(18,2)" },
      { name: "responsible_user_id", type: "BIGINT", note: "→ amo_users.id" },
      { name: "closed_at", type: "TIMESTAMPTZ" },
      { name: "created_at", type: "TIMESTAMPTZ" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "is_deleted", type: "BOOLEAN" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  pipelines: {
    name: "pipelines",
    purpose: "Воронки",
    primaryKey: ["id"],
    preferredColumns: ["id", "name", "sort", "is_archived", "updated_at"],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "name", type: "TEXT" },
      { name: "sort", type: "INTEGER" },
      { name: "is_archived", type: "BOOLEAN" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  stages: {
    name: "stages",
    purpose: "Этапы воронки (имя статуса). НЕТ колонки stages.id — PK составной.",
    primaryKey: ["pipeline_id", "status_id"],
    preferredColumns: ["pipeline_id", "status_id", "name", "sort", "is_archived"],
    columns: [
      { name: "pipeline_id", type: "BIGINT", note: "PK part; → pipelines.id" },
      { name: "status_id", type: "BIGINT", note: "PK part; matches leads.status_id" },
      { name: "name", type: "TEXT" },
      { name: "sort", type: "INTEGER" },
      { name: "is_archived", type: "BOOLEAN" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
    ],
  },
  contacts: {
    name: "contacts",
    purpose: "Контакты (телефон/email — через custom_field_values, не отдельные колонки)",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "name",
      "company_id",
      "linked_company_id",
      "responsible_user_id",
      "created_at",
      "updated_at",
      "is_deleted",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "name", type: "TEXT" },
      { name: "linked_company_id", type: "BIGINT" },
      { name: "company_id", type: "BIGINT" },
      { name: "responsible_user_id", type: "BIGINT" },
      { name: "created_at", type: "TIMESTAMPTZ" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "is_deleted", type: "BOOLEAN" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  companies: {
    name: "companies",
    purpose: "Компании",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "name",
      "responsible_user_id",
      "created_at",
      "updated_at",
      "is_deleted",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "name", type: "TEXT" },
      { name: "responsible_user_id", type: "BIGINT" },
      { name: "created_at", type: "TIMESTAMPTZ" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "is_deleted", type: "BOOLEAN" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  amo_users: {
    name: "amo_users",
    purpose: "Менеджеры / пользователи amoCRM",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "name",
      "email",
      "department_name",
      "is_active",
      "created_at",
      "updated_at",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "name", type: "TEXT" },
      { name: "email", type: "TEXT" },
      { name: "department_name", type: "TEXT" },
      { name: "is_active", type: "BOOLEAN" },
      { name: "created_at", type: "TIMESTAMPTZ" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  tasks: {
    name: "tasks",
    purpose: "Задачи; связь через entity_type + entity_id",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "entity_type",
      "entity_id",
      "task_type",
      "text",
      "status",
      "complete_till",
      "responsible_user_id",
      "is_deleted",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "entity_type", type: "TEXT", note: "e.g. leads, contacts, companies" },
      { name: "entity_id", type: "BIGINT" },
      { name: "task_type", type: "TEXT" },
      { name: "text", type: "TEXT" },
      { name: "status", type: "TEXT" },
      { name: "result_text", type: "TEXT" },
      { name: "complete_till", type: "TIMESTAMPTZ" },
      { name: "responsible_user_id", type: "BIGINT" },
      { name: "created_at", type: "TIMESTAMPTZ" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "is_deleted", type: "BOOLEAN" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  notes: {
    name: "notes",
    purpose: "Примечания; entity_type + entity_id",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "entity_type",
      "entity_id",
      "note_type",
      "text",
      "created_by",
      "created_at",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK" },
      { name: "entity_type", type: "TEXT" },
      { name: "entity_id", type: "BIGINT" },
      { name: "note_type", type: "TEXT" },
      { name: "text", type: "TEXT" },
      { name: "created_by", type: "BIGINT" },
      { name: "created_at", type: "TIMESTAMPTZ" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
      { name: "raw", type: "JSONB", note: "bulky; avoid unless needed" },
    ],
  },
  events: {
    name: "events",
    purpose: "События; entity_type + entity_id",
    primaryKey: ["id"],
    preferredColumns: [
      "id",
      "entity_type",
      "entity_id",
      "action",
      "event_time",
      "ingested_at",
    ],
    columns: [
      { name: "id", type: "BIGSERIAL", note: "PK" },
      { name: "entity_type", type: "TEXT" },
      { name: "entity_id", type: "BIGINT" },
      { name: "action", type: "TEXT" },
      { name: "event_time", type: "TIMESTAMPTZ" },
      { name: "payload", type: "JSONB", note: "bulky; avoid unless needed" },
      { name: "ingested_at", type: "TIMESTAMPTZ" },
    ],
  },
  custom_fields: {
    name: "custom_fields",
    purpose: "Справочник пользовательских полей",
    primaryKey: ["id", "entity_type"],
    preferredColumns: [
      "id",
      "entity_type",
      "name",
      "code",
      "field_type",
      "is_active",
    ],
    columns: [
      { name: "id", type: "BIGINT", note: "PK part" },
      { name: "entity_type", type: "TEXT", note: "PK part" },
      { name: "name", type: "TEXT" },
      { name: "code", type: "TEXT" },
      { name: "field_type", type: "TEXT" },
      { name: "enums", type: "JSONB" },
      { name: "is_active", type: "BOOLEAN" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
    ],
  },
  custom_field_values: {
    name: "custom_field_values",
    purpose: "Значения кастомных полей (телефон/email и т.д.)",
    primaryKey: ["entity_type", "entity_id", "custom_field_id", "value_text"],
    preferredColumns: [
      "entity_type",
      "entity_id",
      "custom_field_id",
      "value_text",
      "updated_at",
    ],
    columns: [
      { name: "entity_type", type: "TEXT", note: "PK part" },
      { name: "entity_id", type: "BIGINT", note: "PK part" },
      { name: "custom_field_id", type: "BIGINT", note: "PK part → custom_fields.id" },
      { name: "value_text", type: "TEXT", note: "PK part" },
      { name: "value_json", type: "JSONB" },
      { name: "updated_at", type: "TIMESTAMPTZ" },
    ],
  },
  lead_contacts: {
    name: "lead_contacts",
    purpose: "Связь сделка ↔ контакт",
    primaryKey: ["lead_id", "contact_id"],
    preferredColumns: ["lead_id", "contact_id", "is_main"],
    columns: [
      { name: "lead_id", type: "BIGINT", note: "PK part → leads.id" },
      { name: "contact_id", type: "BIGINT", note: "PK part → contacts.id" },
      { name: "is_main", type: "BOOLEAN" },
    ],
  },
};

export const COMMON_JOINS = [
  "leads.pipeline_id = pipelines.id",
  "leads.pipeline_id = stages.pipeline_id AND leads.status_id = stages.status_id  (stages has NO id column)",
  "leads.responsible_user_id = amo_users.id",
  "leads.company_id = companies.id",
  "leads.main_contact_id = contacts.id",
  "lead_contacts.lead_id = leads.id AND lead_contacts.contact_id = contacts.id",
  "tasks: entity_type = 'leads' AND entity_id = leads.id (same pattern for notes/events)",
  "custom_field_values.custom_field_id = custom_fields.id AND same entity_type",
] as const;

export const GOTCHAS = [
  "stages PK is (pipeline_id, status_id). Never use stages.id — it does not exist.",
  "Active leads: is_deleted = FALSE AND status_id NOT IN (142, 143). Won=142, Lost=143.",
  "Prefer stages.name for human-readable stage labels within a pipeline.",
  "Phone/email are not columns on contacts — use custom_fields + custom_field_values.",
  "Do not query raw_webhooks or sync_state.",
  "Avoid SELECT * and avoid selecting raw/payload JSON unless required.",
] as const;

export const EXAMPLE_QUERIES = [
  {
    title: "Active leads count",
    sql: "SELECT COUNT(*) AS count FROM leads WHERE is_deleted = FALSE AND status_id NOT IN (142, 143)",
  },
  {
    title: "Lead with pipeline and stage names",
    sql: `SELECT l.id, l.name, p.name AS pipeline, s.name AS stage, l.status_id, l.price
FROM leads l
LEFT JOIN pipelines p ON p.id = l.pipeline_id
LEFT JOIN stages s ON s.pipeline_id = l.pipeline_id AND s.status_id = l.status_id
WHERE l.id = 123 AND l.is_deleted = FALSE`,
  },
  {
    title: "Leads of a contact",
    sql: `SELECT l.id, l.name, l.price, l.status_id, l.updated_at
FROM lead_contacts lc
JOIN leads l ON l.id = lc.lead_id
WHERE lc.contact_id = 456 AND l.is_deleted = FALSE
ORDER BY l.updated_at DESC
LIMIT 10`,
  },
  {
    title: "Tasks for a lead",
    sql: `SELECT id, text, status, complete_till, responsible_user_id
FROM tasks
WHERE entity_type = 'leads' AND entity_id = 123 AND is_deleted = FALSE
ORDER BY complete_till NULLS LAST
LIMIT 10`,
  },
] as const;

/** Compact text embedded into query_amocrm_database tool description. */
export function buildQueryToolSchemaSummary(): string {
  const lines: string[] = [
    "SCHEMA (public only; do not invent columns):",
    "",
    "leads: id, name, status_id, pipeline_id, company_id, main_contact_id, price, responsible_user_id, closed_at, created_at, updated_at, is_deleted, raw",
    "pipelines: id, name, sort, is_archived, updated_at, raw",
    "stages: pipeline_id, status_id, name, sort, is_archived, updated_at  — NO stages.id; PK=(pipeline_id,status_id)",
    "contacts: id, name, linked_company_id, company_id, responsible_user_id, created_at, updated_at, is_deleted, raw",
    "companies: id, name, responsible_user_id, created_at, updated_at, is_deleted, raw",
    "amo_users: id, name, email, department_name, is_active, created_at, updated_at, raw",
    "tasks: id, entity_type, entity_id, task_type, text, status, result_text, complete_till, responsible_user_id, created_at, updated_at, is_deleted, raw",
    "notes: id, entity_type, entity_id, note_type, text, created_by, created_at, updated_at, raw",
    "events: id, entity_type, entity_id, action, event_time, payload, ingested_at",
    "custom_fields: id, entity_type, name, code, field_type, enums, is_active, updated_at",
    "custom_field_values: entity_type, entity_id, custom_field_id, value_text, value_json, updated_at",
    "lead_contacts: lead_id, contact_id, is_main",
    "",
    "Common joins:",
    ...COMMON_JOINS.map((j) => `- ${j}`),
    "",
    "Gotchas:",
    ...GOTCHAS.map((g) => `- ${g}`),
  ];
  return lines.join("\n");
}

export function getAmocrmSchemaPayload(tableFilter?: string): {
  success: true;
  schema: "public";
  tables: TableSchema[];
  joins: readonly string[];
  gotchas: readonly string[];
  examples: readonly { title: string; sql: string }[];
} {
  const wanted = tableFilter?.trim().toLowerCase();
  const tables = ALLOWED_TABLES.map((name) => TABLE_SCHEMAS[name]).filter((t) =>
    wanted ? t.name === wanted : true,
  );

  return {
    success: true,
    schema: "public",
    tables,
    joins: COMMON_JOINS,
    gotchas: GOTCHAS,
    examples: EXAMPLE_QUERIES,
  };
}

/**
 * Build a hint when Postgres reports missing column / relation.
 */
export function buildSchemaErrorHint(pgMessage: string): string | undefined {
  const colMatch = pgMessage.match(
    /column\s+(?:(?:"?([a-zA-Z_][\w]*)"?)\.)?(?:"?([a-zA-Z_][\w]*)"?)\s+does not exist/i,
  );
  if (colMatch) {
    const maybeTable = colMatch[1]?.toLowerCase();
    const badColumn = colMatch[2]!.toLowerCase();

    if (maybeTable && maybeTable in TABLE_SCHEMAS) {
      const table = TABLE_SCHEMAS[maybeTable as AllowedTable];
      return formatTableHint(table, badColumn);
    }

    // No table qualifier — try to find which allowed tables lack this column,
    // and mention stages.id specially.
    if (badColumn === "id") {
      const stages = TABLE_SCHEMAS.stages;
      return (
        `Колонка id отсутствует у stages. ${formatTableHint(stages)}. ` +
        `Для остальных таблиц id обычно есть (leads.id, pipelines.id, …). ` +
        `При сомнении вызовите get_amocrm_schema.`
      );
    }

    const candidates = ALLOWED_TABLES.filter(
      (name) =>
        !TABLE_SCHEMAS[name].columns.some((c) => c.name === badColumn),
    );
    const withCol = ALLOWED_TABLES.filter((name) =>
      TABLE_SCHEMAS[name].columns.some((c) => c.name === badColumn),
    );

    if (withCol.length > 0 && candidates.length > 0) {
      return (
        `Колонка "${badColumn}" есть в: ${withCol.join(", ")}. ` +
        `Проверьте алиас/таблицу. Для stages используйте status_id + pipeline_id, не id. ` +
        `Вызовите get_amocrm_schema при необходимости.`
      );
    }

    return (
      `Неизвестная колонка "${badColumn}". ` +
      `Разрешённые таблицы: ${ALLOWED_TABLES.join(", ")}. ` +
      `Вызовите get_amocrm_schema для точного списка колонок.`
    );
  }

  const relMatch = pgMessage.match(
    /relation\s+"?(?:public\.)?([a-zA-Z_][\w]*)"?\s+does not exist/i,
  );
  if (relMatch) {
    return (
      `Таблица "${relMatch[1]}" недоступна или не существует. ` +
      `Разрешены: ${ALLOWED_TABLES.join(", ")}.`
    );
  }

  return undefined;
}

function formatTableHint(table: TableSchema, badColumn?: string): string {
  const cols = table.columns.map((c) => c.name).join(", ");
  const pk = table.primaryKey.join(", ");
  const bad =
    badColumn !== undefined
      ? ` Колонки "${badColumn}" в ${table.name} нет.`
      : "";
  return (
    `Таблица ${table.name} (PK: ${pk}): ${cols}.${bad}` +
    (table.name === "stages"
      ? " Join: ON stages.pipeline_id = leads.pipeline_id AND stages.status_id = leads.status_id."
      : "")
  );
}

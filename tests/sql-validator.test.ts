import { describe, expect, it } from "vitest";
import { validateReadonlySql } from "../src/security/sql-validator.js";

const opts = {
  maxSqlLength: 10_000,
  schema: "public",
};

describe("validateReadonlySql", () => {
  it("allows SELECT", () => {
    const r = validateReadonlySql(
      "SELECT COUNT(*) AS count FROM leads WHERE is_deleted = FALSE",
      opts,
    );
    expect(r.ok).toBe(true);
  });

  it("allows WITH ... SELECT", () => {
    const r = validateReadonlySql(
      `WITH active AS (
         SELECT id FROM leads WHERE status_id NOT IN (142, 143)
       )
       SELECT COUNT(*) FROM active`,
      opts,
    );
    expect(r.ok).toBe(true);
  });

  it("blocks INSERT", () => {
    const r = validateReadonlySql(
      "INSERT INTO leads (id, name) VALUES (1, 'x')",
      opts,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/INSERT|SELECT/i);
  });

  it("blocks UPDATE", () => {
    const r = validateReadonlySql("UPDATE leads SET name = 'x' WHERE id = 1", opts);
    expect(r.ok).toBe(false);
  });

  it("blocks DELETE", () => {
    const r = validateReadonlySql("DELETE FROM leads WHERE id = 1", opts);
    expect(r.ok).toBe(false);
  });

  it("blocks DROP", () => {
    const r = validateReadonlySql("DROP TABLE leads", opts);
    expect(r.ok).toBe(false);
  });

  it("blocks multiple statements", () => {
    const r = validateReadonlySql(
      "SELECT 1; SELECT 2",
      opts,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/одн/i);
  });

  it("blocks SET session", () => {
    const r = validateReadonlySql("SET statement_timeout = 0", opts);
    expect(r.ok).toBe(false);
  });

  it("blocks dangerous functions", () => {
    const r = validateReadonlySql(
      "SELECT pg_read_file('/etc/passwd')",
      opts,
    );
    expect(r.ok).toBe(false);
  });

  it("blocks raw_webhooks", () => {
    const r = validateReadonlySql("SELECT * FROM raw_webhooks LIMIT 1", opts);
    expect(r.ok).toBe(false);
  });

  it("blocks sync_state", () => {
    const r = validateReadonlySql("SELECT * FROM sync_state", opts);
    expect(r.ok).toBe(false);
  });

  it("blocks information_schema", () => {
    const r = validateReadonlySql(
      "SELECT table_name FROM information_schema.tables",
      opts,
    );
    expect(r.ok).toBe(false);
  });

  it("allows is_deleted column (does not treat as DELETE)", () => {
    const r = validateReadonlySql(
      "SELECT id FROM leads WHERE is_deleted = FALSE LIMIT 10",
      opts,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects empty SQL", () => {
    const r = validateReadonlySql("   ", opts);
    expect(r.ok).toBe(false);
  });

  it("rejects oversized SQL", () => {
    const r = validateReadonlySql("SELECT 1" + " ".repeat(20), {
      ...opts,
      maxSqlLength: 5,
    });
    expect(r.ok).toBe(false);
  });

  it("blocks FOR UPDATE", () => {
    const r = validateReadonlySql("SELECT id FROM leads FOR UPDATE", opts);
    expect(r.ok).toBe(false);
  });

  it("ignores keywords inside string literals", () => {
    const r = validateReadonlySql(
      "SELECT id FROM leads WHERE name = 'DELETE ME' LIMIT 1",
      opts,
    );
    expect(r.ok).toBe(true);
  });
});

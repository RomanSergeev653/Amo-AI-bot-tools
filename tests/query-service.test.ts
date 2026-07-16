import { describe, expect, it, vi, beforeEach } from "vitest";
import { redactSecrets } from "../src/config/env.js";
import type { DbConfig } from "../src/config/env.js";

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock("../src/db/pool.js", () => ({
  withReadonlyClient: async (
    _config: DbConfig,
    fn: (client: { query: typeof mockQuery }) => Promise<unknown>,
  ) => fn({ query: mockQuery }),
  getPool: vi.fn(),
  checkConnection: vi.fn(),
  checkReadableTables: vi.fn(),
  closePool: vi.fn(),
}));

import { runReadonlyQuery } from "../src/tools/query-service.js";

const baseConfig: DbConfig = {
  host: "127.0.0.1",
  port: 5432,
  database: "amocrm",
  user: "ro",
  password: "secret-password-xyz",
  sslmode: "disable",
  statementTimeoutMs: 10_000,
  maxRows: 100,
  defaultRows: 10,
  maxResultBytes: 102_400,
  maxSqlLength: 10_000,
  schema: "public",
};

describe("runReadonlyQuery", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockReset();
  });

  it("returns success for valid SELECT", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: 37 }],
      fields: [{ name: "count" }],
    });

    const result = await runReadonlyQuery(
      { sql: "SELECT COUNT(*) AS count FROM leads", purpose: "count leads" },
      baseConfig,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toEqual([{ count: 37 }]);
      expect(result.row_count).toBe(1);
      expect(result.truncated).toBe(false);
    }
    expect(mockQuery).toHaveBeenCalled();
    const sql = String(mockQuery.mock.calls[0]?.[0]);
    expect(sql).toMatch(/LIMIT 10/);
  });

  it("rejects INSERT before hitting the DB", async () => {
    const result = await runReadonlyQuery(
      { sql: "INSERT INTO leads (id) VALUES (1)", purpose: "bad" },
      baseConfig,
    );
    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("caps max_rows by hard limit", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 100 }, (_, i) => ({ id: i })),
      fields: [{ name: "id" }],
    });

    await runReadonlyQuery(
      {
        sql: "SELECT id FROM leads",
        purpose: "list",
        max_rows: 10_000,
      },
      baseConfig,
    );

    const sql = String(mockQuery.mock.calls[0]?.[0]);
    expect(sql).toMatch(/LIMIT 100/);
  });

  it("maps timeout errors", async () => {
    mockQuery.mockRejectedValueOnce(
      new Error("canceling statement due to statement timeout"),
    );
    const result = await runReadonlyQuery(
      { sql: "SELECT id FROM leads", purpose: "slow" },
      baseConfig,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error_type).toBe("timeout");
  });

  it("maps connection errors", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const result = await runReadonlyQuery(
      { sql: "SELECT 1", purpose: "ping" },
      baseConfig,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error_type).toBe("connection_error");
  });

  it("adds schema_hint when column does not exist", async () => {
    mockQuery.mockRejectedValueOnce(new Error('column "id" does not exist'));
    const result = await runReadonlyQuery(
      { sql: "SELECT id FROM stages", purpose: "bad stages id" },
      baseConfig,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_type).toBe("execution_error");
      expect(result.schema_hint).toMatch(/stages/i);
      expect(result.schema_hint).toMatch(/status_id/i);
    }
  });

  it("returns empty result set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], fields: [{ name: "id" }] });
    const result = await runReadonlyQuery(
      { sql: "SELECT id FROM leads WHERE id = -1", purpose: "empty" },
      baseConfig,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.row_count).toBe(0);
      expect(result.rows).toEqual([]);
    }
  });

  it("rejects oversized result payload", async () => {
    const big = "x".repeat(50_000);
    mockQuery.mockResolvedValueOnce({
      rows: [{ a: big }, { a: big }, { a: big }],
      fields: [{ name: "a" }],
    });
    const result = await runReadonlyQuery(
      { sql: "SELECT a FROM leads", purpose: "big", max_rows: 3 },
      { ...baseConfig, maxResultBytes: 1000 },
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error_type).toBe("result_too_large");
  });
});

describe("redactSecrets", () => {
  it("hides password values", () => {
    const out = redactSecrets(
      "password=secret-password-xyz failed for user",
      "secret-password-xyz",
    );
    expect(out).not.toContain("secret-password-xyz");
    expect(out).toMatch(/REDACTED/);
  });

  it("hides connection string passwords", () => {
    const out = redactSecrets(
      "postgresql://ro:secret-password-xyz@127.0.0.1/amocrm",
      "secret-password-xyz",
    );
    expect(out).not.toContain("secret-password-xyz");
  });
});

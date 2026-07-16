import { describe, expect, it } from "vitest";
import {
  buildSchemaErrorHint,
  getAmocrmSchemaPayload,
  TABLE_SCHEMAS,
} from "../src/schema/amocrm-schema.js";

describe("amocrm schema dictionary", () => {
  it("exposes stages without id column", () => {
    const cols = TABLE_SCHEMAS.stages.columns.map((c) => c.name);
    expect(cols).not.toContain("id");
    expect(cols).toContain("status_id");
    expect(cols).toContain("pipeline_id");
  });

  it("returns full schema payload", () => {
    const payload = getAmocrmSchemaPayload();
    expect(payload.success).toBe(true);
    expect(payload.tables.length).toBeGreaterThan(5);
    expect(payload.joins.length).toBeGreaterThan(0);
  });

  it("filters by table name", () => {
    const payload = getAmocrmSchemaPayload("stages");
    expect(payload.tables).toHaveLength(1);
    expect(payload.tables[0]?.name).toBe("stages");
  });

  it("hints when stages.id is missing", () => {
    const hint = buildSchemaErrorHint('column "id" does not exist');
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/stages/i);
    expect(hint).toMatch(/status_id/i);
  });

  it("hints for qualified missing column", () => {
    const hint = buildSchemaErrorHint("column s.id does not exist");
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/stages/i);
  });

  it("hints for unknown relation", () => {
    const hint = buildSchemaErrorHint('relation "raw_webhooks" does not exist');
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/Разрешены/i);
  });
});

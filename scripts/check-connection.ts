import { loadDbConfig, redactSecrets } from "../src/config/env.js";
import {
  checkConnection,
  checkReadableTables,
  closePool,
} from "../src/db/pool.js";

const BUSINESS_TABLES = [
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
];

async function main(): Promise<void> {
  let config;
  try {
    config = loadDbConfig();
  } catch (err) {
    console.error(
      err instanceof Error ? err.message : "Failed to load DB config",
    );
    process.exitCode = 1;
    return;
  }

  const safeTarget = `${config.user}@${config.host}:${config.port}/${config.database}`;
  console.log(`Connecting to ${safeTarget} (sslmode=${config.sslmode})...`);

  try {
    await checkConnection(config);
    console.log("SELECT 1 — OK");
  } catch (err) {
    const msg = redactSecrets(
      err instanceof Error ? err.message : String(err),
      config.password,
    );
    console.error(`Connection failed: ${msg}`);
    process.exitCode = 1;
    return;
  }

  console.log("Checking read access to business tables...");
  const results = await checkReadableTables(config, BUSINESS_TABLES);
  let failed = 0;
  for (const row of results) {
    if (row.ok) {
      console.log(`  ✓ ${row.table}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${row.table}: ${row.error ?? "error"}`);
    }
  }

  // Privilege warning (read-only preferred, not enforced by CREATE/GRANT here).
  try {
    const { withReadonlyClient } = await import("../src/db/pool.js");
    await withReadonlyClient(config, async (client) => {
      const r = await client.query<{ rolsuper: boolean; rolcreatedb: boolean }>(
        `SELECT r.rolsuper, r.rolcreatedb
         FROM pg_roles r
         WHERE r.rolname = current_user`,
      );
      const role = r.rows[0];
      if (role?.rolsuper || role?.rolcreatedb) {
        console.warn(
          "WARNING: DB user looks privileged (superuser/createdb). Prefer a read-only role.",
        );
      }
    });
  } catch {
    /* optional */
  }

  if (failed > 0) {
    console.error(
      `Read check failed for ${failed} table(s). Fix grants or table names.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("All checks passed.");
}

main()
  .catch((err) => {
    console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });

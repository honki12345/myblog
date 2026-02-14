import process from "node:process";
import { getDatabasePath, getDb, getSchemaVersion } from "../src/lib/db";

function main() {
  const db = getDb();
  const schemaVersion = getSchemaVersion(db);

  console.log(`[db:migrate] path=${getDatabasePath()}`);
  console.log(`[db:migrate] schema_version=${schemaVersion}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db:migrate] failed: ${message}`);
  process.exit(1);
}

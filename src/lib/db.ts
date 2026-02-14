import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = "blog.db";

export function ensureDataDirectory() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getDatabasePath() {
  return path.join(DATA_DIR, DB_FILE);
}

export function initializeDatabase() {
  ensureDataDirectory();

  return {
    path: getDatabasePath(),
    initialized: true,
  };
}

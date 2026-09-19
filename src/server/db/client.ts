import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * ローカルSQLite DBへの接続。
 *
 * `DATABASE_URL` はファイルパスとして扱う(例: "./data/grape.db")。
 * 未設定時は `./data/grape.db` を既定値とし、`.env.local` での上書きを想定する。
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "./data/grape.db";

const sqlite = new Database(DATABASE_URL);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'exortc.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'models', 'schema.sql');

let db: SqlJsDatabase;

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
export async function initDatabase(): Promise<SqlJsDatabase> {
    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Run schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.run(schema);

    // Migration: Add voice_mode column to rooms if it doesn't exist
    try {
        const columns = all<{ name: string }>(`PRAGMA table_info(rooms)`);
        const hasVoiceMode = columns.some(c => c.name === 'voice_mode');
        if (!hasVoiceMode) {
            db.run(`ALTER TABLE rooms ADD COLUMN voice_mode TEXT DEFAULT 'ptt'`);
            console.log('Migrated: Added voice_mode column to rooms');
        }
    } catch (e) {
        console.warn('Migration check failed for rooms:', e);
    }

    // Migration: Add profile_color column to users if it doesn't exist
    try {
        const columns = all<{ name: string }>(`PRAGMA table_info(users)`);
        const hasProfileColor = columns.some(c => c.name === 'profile_color');
        if (!hasProfileColor) {
            db.run(`ALTER TABLE users ADD COLUMN profile_color TEXT DEFAULT '#CC2244'`);
            console.log('Migrated: Added profile_color column to users');
        }
    } catch (e) {
        console.warn('Migration check failed for users:', e);
    }

    // Save database
    saveDatabase();

    return db;
}

// Save database to file
export function saveDatabase(): void {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

// Get database instance (must call initDatabase first)
export function getDb(): SqlJsDatabase {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

// Helper to run a query and get all results
export function all<T>(sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
}

// Helper to run a query and get first result
export function get<T>(sql: string, params: any[] = []): T | undefined {
    const results = all<T>(sql, params);
    return results[0];
}

// Helper to run a statement (INSERT, UPDATE, DELETE)
export function run(sql: string, params: any[] = []): { changes: number } {
    db.run(sql, params);
    saveDatabase();
    return { changes: db.getRowsModified() };
}

export default { initDatabase, getDb, all, get, run, saveDatabase };

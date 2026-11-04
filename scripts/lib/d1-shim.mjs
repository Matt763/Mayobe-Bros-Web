// A minimal stand-in for Cloudflare D1, built on Node's built-in SQLite. Used by the tests and by scripts/dev-api.mjs.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function makeD1(migration = new URL('../../worker/migrations/0001_init.sql', import.meta.url)) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(migration, 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    _exec: () => db.prepare(sql).all(...args),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec('BEGIN'); try { const out = list.map((s) => ({ results: s._exec() })); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    raw: db,
  };
}

// A minimal stand-in for Cloudflare D1, built on Node's built-in SQLite. Used by the tests and by scripts/dev-api.mjs.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function makeD1(dir = new URL('../../worker/migrations/', import.meta.url)) {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(f, dir), 'utf8')); // every migration, in order
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

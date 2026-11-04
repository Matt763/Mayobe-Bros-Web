// Minimal front-matter parser (a safe subset of YAML): `key: value`, quoted strings,
// true/false and inline lists like `tags: [a, b, "c d"]`. No dependencies.

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  return v;
}

function splitList(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map((x) => unquote(x.trim())).filter((x) => x !== '');
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']')) return splitList(v.slice(1, -1));
  return unquote(v);
}

export function parseFrontMatter(text) {
  const m = text.replace(/^﻿/, '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    data[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  return { data, body: m[2] };
}

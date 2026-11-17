/* Decoder for the compact results files, data contract v3. ES module for the browser, Node and Cloudflare Workers:
   no dependencies, no DOM, no Node-only APIs. The encoder is scripts/lib/results-pack.mjs; the written format
   ("Data contract (v3)") is in docs/superpowers/specs/2026-11-10-results-app-design.md.

   Files of one exam (results-data/<exam>/):
     meta.json        small tables every centre needs: subjects, rules, templates, level tables (and, for primary exams, the
                      dictionary of whole grade strings)
     list.json        the centre list (decodeList)
     <lowercode>.txt  one centre, ten lines separated by "\n":
        0 header   seq;name;url;summaryMode;overallMode;factsMode;counts;absent;code
        1 sex      run-length text, e.g. F502M427
        2 markers  rows without grades (withheld, nullified ...) joined by \x1f
        3 subjects secondary: the subjects this centre uses (base62 digits of the exam's canonical subject order)
        4 grades   secondary: one fixed-width block per candidate, a grade letter or "." per subject
                   primary: the candidate's grade string as a code into meta.pd
        5 aggt     explicit aggregate column (only when meta.rule is 0)
        6 exceptions  "k,aggt,div" where aggt or division differs from what the rule predicts
        7 stored   numbers that cannot be derived (region and GPA, or mark totals)
        8 patches  JSON [[cell, text]] for cells of the derived blocks that differ from the prediction
        9 raw      JSON [summary, overall, facts] for blocks stored whole
       10 odd rows (optional, added without changing the version) candidates whose subjects are not in the exam's canonical order:
                  "pos\taggt\tdiv\t" + one base62 subject digit and one grade character per subject, joined by \x1f
   Optional header field 9 (after the code): the number separator when it is not the exam's own ("-" or "/"), or "*" when the
   sequence entries are whole candidate numbers. Optional meta fields: `gs` (10 = the aggregate is a GPA stored in tenths),
   `sd` (2 when an exam has more than 62 subjects: subject places are then written with two digits), `dw` (division words in the order the header counts them; default I, II, III, IV, 0) and `dp` (how many leading words count as
   passed; default 4).
   Line 0 alone gives the statistics (decodeHeader, stats) without touching a single row. Summary, overall blocks and facts are
   worked out from the rows and patched, so what decodeCentre returns is exactly what the source had. */
export const CODEC_VERSION = 3;

const B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const b62 = (ch) => B.indexOf(ch);
export const b62char = (n) => B[n];

const num = (s) => +s;
/** A subject's place in meta.subjects, written with `sd` base62 digits (1, or 2 when an exam has more than 62 subjects). */
const subjectIndex = (str, at, sd) => (sd === 1 ? B.indexOf(str[at]) : B.indexOf(str[at]) * 62 + B.indexOf(str[at + 1]));
const localSubjects = (str, sd) => { const o = []; for (let q = 0; q < str.length; q += sd) o.push(subjectIndex(str, q, sd)); return o; };
export const subjectChars = (p, sd) => (sd === 2 ? B[Math.floor(p / 62)] + B[p % 62] : B[p]);
export const DEFAULT_WORDS = ['I', 'II', 'III', 'IV', '0'];
/** Division words in the order the header counts them. */
export const wordsOf = (meta) => meta.dw || DEFAULT_WORDS;
/** How a stored aggregate character reads: a whole number, or a GPA in tenths ("2.9") when meta.gs is 10. */
export const aggtFromChar = (meta, ch) => {
  if (ch === '-') return '-';
  const v = B.indexOf(ch);
  return meta.gs ? (v / meta.gs).toFixed(1) : String(v);
};
/** The character for an aggregate, or null when it cannot be stored in the column (it is then kept as an exception). */
export const charFromAggt = (meta, a) => {
  if (a === '-') return '-';
  if (meta.gs) {
    if (!/^\d{1,2}\.\d$/.test(a)) return null;
    const v = Math.round(+a * meta.gs);
    return v < 62 && aggtFromChar(meta, B[v]) === a ? B[v] : null;
  }
  return /^\d+$/.test(a) && +a < 62 && String(+a) === a ? B[+a] : null;
};
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Level label for a value: the last table entry whose threshold the value reaches ("-" when none). */
export function levelOf(table, v) {
  let r = '-';
  for (const t of table) if (v >= t[0]) r = t[1];
  return r;
}

/** Grade letter to points, as an object, from meta.pts ("A1B2C3..."). */
function pointsOf(meta) {
  if (!meta._p) {
    const p = {};
    for (let i = 0; i + 1 < meta.pts.length; i += 2) p[meta.pts[i]] = +meta.pts[i + 1];
    Object.defineProperty(meta, '_p', { value: p, enumerable: false });
  }
  return meta._p;
}

function parseSex(s) {
  const out = [];
  const re = /(\D)(\d+)/g;
  let m;
  while ((m = re.exec(s))) for (let i = 0; i < +m[2]; i++) out.push(m[1]);
  return out;
}

function parseSeq(spec, n, width) {
  const pad = (i) => String(i).padStart(width, '0');
  const out = [];
  if (spec[0] === 'l') return spec.slice(1).split(',');
  if (spec === '') { for (let i = 1; i <= n; i++) out.push(pad(i)); return out; }
  for (const r of spec.slice(1).split(',')) {
    const [a, b] = r.split('-').map(num);
    for (let i = a, to = b === undefined ? a : b; i <= to; i++) out.push(pad(i));
  }
  return out;
}

/**
 * Statistics line of a centre file, without decoding any row.
 * { n, absent, byGroup }: byGroup is [F counts, M counts], one count per division I, II, III, IV, 0 (secondary exams)
 * or per Average Grade A to E (primary exams); sexes follow meta.sx. n counts every listed candidate, markers included.
 */
export function decodeHeader(text) {
  const a = text.indexOf('\n');
  const b = text.indexOf('\n', a + 1);
  const f = text.slice(0, a).split(';');
  let n = 0;
  const re = /\D(\d+)/g;
  const sexLine = text.slice(a + 1, b < 0 ? undefined : b);
  let m;
  while ((m = re.exec(sexLine))) n += +m[1];
  return { n, absent: num(f[7] || 0), byGroup: f[6] ? f[6].split('/').map((x) => x.split(',').map(num)) : [] };
}

/**
 * Plain numbers for a page from a header. Secondary: `sat` = candidates who sat (n minus absent), `passed` = candidates with
 * a division I to IV, `passRate` = passed / sat (null when nobody sat). Primary: `groups` = candidates per grade A to E.
 */
export function stats(header, kind, meta) {
  const by = header.byGroup;
  const total = (by[0] || []).map((x, k) => x + (by[1] ? by[1][k] : 0));
  const out = { n: header.n, absent: header.absent, sat: header.n - header.absent, total, female: by[0] || [], male: by[1] || [] };
  if (kind === 'primary') return { ...out, groups: total };
  const dp = meta && meta.dp !== undefined ? meta.dp : 4;
  out.passed = total.slice(0, dp).reduce((a, b) => a + b, 0);
  out.words = meta && meta.dw ? meta.dw : DEFAULT_WORDS;
  out.passRate = out.sat > 0 ? out.passed / out.sat : null;
  return out;
}

/** Cells of the derived blocks in a fixed order (the order patches refer to). Each cell is [container, key]. */
export function cellsOf(o, f) {
  const c = [];
  if (o) {
    for (const b of o) {
      if (b.t === 'h') c.push([b, 'v']);
      else if (b.t === 'kv') for (const r of b.rows) { c.push([r, 0]); c.push([r, 1]); }
      else { b.head.forEach((_, i) => c.push([b.head, i])); for (const r of b.rows) r.forEach((_, i) => c.push([r, i])); }
    }
  }
  if (f) for (const r of f) { c.push([r, 0]); c.push([r, 1]); }
  return c;
}

const fitsSecondary = (t) => t && t[1] && t[1].t === 'kv' && t[1].rows.length >= 3 && t[3] && t[3].t === 'grid' && t[5] && t[5].t === 'grid';
const fitsPrimary = (t) => t && t[1] && t[1].t === 'grid';

/**
 * The summary, overall blocks and facts that follow from the numbers in a centre file.
 * p = { n, nonMarker, absent, cnt (counts per sex), st (per subject stats), V (stored numbers) }.
 */
export function predict(meta, p) {
  const out = { s: null, o: null, f: null };
  const t = meta.tpl;
  const wide = t.s ? t.s.head.length - 1 : 0;
  if (t.s) {
    const rows = [0, 1].map((g) => [t.s.labels[g], ...(p.cnt[g] || []).slice(0, wide).map(String)]);
    rows.push([t.s.labels[2], ...(p.cnt[0] || []).slice(0, wide).map((x, k) => String(x + (p.cnt[1] ? p.cnt[1][k] : 0)))]);
    out.s = { head: t.s.head.slice(), rows };
    out.t = { head: t.s.head.slice(), rows: [['T', ...(p.cnt[0] || []).slice(0, wide).map((x, k) => String(x + (p.cnt[1] ? p.cnt[1][k] : 0)))]] };
  }
  if (meta.kind === 'primary') {
    if (!fitsPrimary(t.o)) return out;
    const o = clone(t.o);
    let tot = 0;
    o[1].rows = p.st.map((s, i) => {
      const c = p.nonMarker - s.x;
      const w = String(c);
      const a = c ? +p.V[i] / c : 0;
      tot += a;
      const as = a.toFixed(4);
      const name = t.o[1].rows[i] ? t.o[1].rows[i][1] : meta.subjects[s.pos];
      return [String(i + 1), name, String(p.n), w, '0', w, String(s.pass), as, c ? levelOf(meta.lv, +as) : '-'];
    });
    out.o = o;
    if (t.f) {
      const f = clone(t.f);
      f[0][1] = String(p.st.length ? p.nonMarker - Math.min(...p.st.map((s) => s.x)) : 0);
      if (f[1]) f[1][1] = tot.toFixed(4);
      if (f[2]) f[2][1] = levelOf(meta.lf, +tot.toFixed(4));
      out.f = f;
    }
    return out;
  }
  if (!fitsSecondary(t.o)) return out;
  const o = clone(t.o);
  const V = p.V;
  const total = p.cnt[0].map((x, k) => x + p.cnt[1][k]);
  const kv = o[1].rows;
  kv[0][1] = V[0] === '' || V[0] === undefined ? '' : meta.regions[V[0] | 0] ?? '';
  kv[1][1] = String(total.slice(0, meta.dp !== undefined ? meta.dp : 4).reduce((a, b) => a + b, 0));
  kv[2][1] = V[1] + ' ' + String(levelOf(meta.lv, +V[1])).toUpperCase();
  const sat = p.n - p.absent;
  o[3].rows = [[String(p.n), String(p.absent), String(sat), '0', '0', String(sat), ...total.slice(0, 5).map(String)]];
  o[5].rows = p.st.filter((s) => s.reg > 0)
    .sort((a, b) => (meta.sm[a.i][0] < meta.sm[b.i][0] ? -1 : 1))
    .map((s) => {
      const clean = s.reg - s.x;
      const gpa = clean ? (s.pts / clean).toFixed(4) : '-';
      return [meta.sm[s.i][0], meta.sm[s.i][1], String(s.reg), String(clean), '0', '0', String(clean), String(s.pass), gpa, clean ? levelOf(meta.lv, +gpa) : '-'];
    });
  out.o = o;
  return out;
}

/** Aggregate of a secondary candidate: the best `meta.rule` points added up ("-" with fewer subjects), or null when stored. */
export function aggtOf(meta, grades) {
  const r = meta.rule;
  if (!r) return null;
  const P = pointsOf(meta);
  const pts = [];
  for (const g of grades) if (P[g]) pts.push(P[g]);
  if (pts.length < r) return '-';
  pts.sort((a, b) => a - b);
  let s = 0;
  for (let i = 0; i < r; i++) s += pts[i];
  return String(s);
}

/** Key into meta.dv for the division of a secondary candidate. */
export function divKey(meta, aggt, grades) {
  if (aggt !== '-') return aggt;
  const P = pointsOf(meta);
  let best = 9, pass = 0, any = false;
  for (const g of grades) {
    if (g !== 'X') any = true;
    const p = P[g];
    if (p) { if (p < best) best = p; if (p <= 4) pass++; }
  }
  return any ? 'p' + best + ':' + Math.min(pass, 3) : 'x';
}
export const divOf = (meta, aggt, grades) => meta.dv[divKey(meta, aggt, grades)];

/**
 * Decode a centre file.
 * `code` is the centre code (the file name in capitals); the header overrides it for the rare code that is not in capitals.
 * Returns { code, name, sourceUrl, summary: {head, rows}|null, facts, overall, candidates: [{cno, sex, aggt, div, grade, subjects, note}] }
 * (aggt/div only for secondary exams, grade only for primary ones, note only for rows without grades).
 */
export function decodeCentre(text, meta, code, opts) {
  if (meta.v !== CODEC_VERSION) throw new Error('Unsupported data version: ' + meta.v);
  const L = text.split('\n');
  const f = L[0].split(';');
  const primary = meta.kind === 'primary';
  const centre = f[8] ? f[8] : code;
  const sex = parseSex(L[1]);
  const n = sex.length;
  const seq = parseSeq(f[0], n, meta.sw);
  const mk = new Map();
  if (L[2]) {
    for (const e of L[2].split('\x1f')) {
      const a = e.split('\t');
      mk.set(num(a[0]), primary ? { note: a.slice(1).join('\t') } : { aggt: a[1], div: a[2], note: a.slice(3).join('\t') });
    }
  }
  const odd = new Map(); // rows whose subjects are not in the canonical order
  if (L[10]) {
    for (const e of L[10].split('\x1f')) {
      const a = e.split('\t');
      const subj = [];
      const sd = meta.sd || 1;
      for (let q = 0; q < a[3].length; q += sd + 1) subj.push([meta.subjects[subjectIndex(a[3], q, sd)], a[3][q + sd]]);
      odd.set(num(a[0]), { aggt: a[1], div: a[2], subjects: subj });
    }
  }
  const nonMarker = n - mk.size - odd.size;
  const sepc = f[9] || (primary ? '-' : '/');
  const ci = f[1].indexOf(':');
  const name = f[1].slice(ci + 1).replace(/\x01/g, ';') + meta.nc[+f[1].slice(0, ci)];
  const sourceUrl = f[2] ? f[2].replace(/\x01/g, ';') : meta.ut.replace('{c}', centre.toLowerCase());

  // grade blocks, one string per candidate that has grades
  const grids = [];
  let local = '';
  const S = meta.subjects.length;
  if (primary) {
    const [a, b] = meta.vc;
    const col = L[4];
    let p = 0;
    for (let k = 0; k < nonMarker; k++) {
      const c = B.indexOf(col[p++]);
      let i;
      if (c < a) i = c;
      else if (c < a + b) i = a + (c - a) * 62 + B.indexOf(col[p++]);
      else { i = a + b * 62 + (c - a - b) * 3844 + B.indexOf(col[p]) * 62 + B.indexOf(col[p + 1]); p += 2; }
      grids.push(meta.pd.substr(i * S, S));
    }
  } else {
    local = L[3];
    const W = localSubjects(local, meta.sd || 1).length;
    for (let k = 0; k < nonMarker; k++) grids.push(L[4].substr(k * W, W));
  }

  // per-subject figures for the derived blocks
  let st;
  if (primary) {
    // a school may take only part of the exam's subject list: a subject it does not take is "." in every grade string
    st = [];
    for (let j = 0; j < S - 1; j++) if (!grids.length || grids.some((g) => g[j] !== '.')) st.push({ pos: j, x: 0, pass: 0 });
    for (const g of grids) {
      for (const s of st) {
        const ch = g[s.pos];
        if (ch === 'X') s.x++;
        else if ('ABC'.includes(ch)) s.pass++;
      }
    }
  } else {
    const P = pointsOf(meta);
    st = localSubjects(local, meta.sd || 1).map((i) => ({ i, reg: 0, x: 0, pass: 0, pts: 0 }));
    for (const g of grids) {
      for (let k = 0; k < st.length; k++) {
        const ch = g[k];
        if (ch === '.') continue;
        const s = st[k];
        s.reg++;
        if (ch === 'X') s.x++;
        else if (P[ch]) { s.pts += P[ch]; if (meta.ps.includes(ch)) s.pass++; }
      }
    }
  }

  // candidates
  const aggtCol = L[5];
  const exc = new Map();
  if (L[6]) for (const e of L[6].split(';')) { const a = e.split(','); exc.set(num(a[0]), [a[1], a[2]]); }
  const candidates = [];
  let nk = 0;
  for (let i = 0; i < n; i++) {
    const c = { cno: sepc === '*' ? seq[i] : centre + sepc + seq[i], sex: sex[i] };
    const o = odd.get(i);
    if (o) { c.aggt = o.aggt; c.div = o.div; c.subjects = o.subjects; candidates.push(c); continue; }
    const m = mk.get(i);
    if (m) {
      if (!primary) { c.aggt = m.aggt; c.div = m.div; }
      c.subjects = [];
      c.note = m.note;
      candidates.push(c);
      continue;
    }
    const g = grids[nk];
    if (primary) {
      c.subjects = meta.subjects.map((s, j) => [s, g[j]]).filter((x) => x[1] !== '.');
      c.grade = g[S - 1];
    } else {
      const subj = [];
      const grs = [];
      for (let k = 0; k < g.length; k++) if (g[k] !== '.') { subj.push([meta.subjects[st[k].i], g[k]]); grs.push(g[k]); }
      c.subjects = subj;
      let a = meta.rule ? aggtOf(meta, grs) : aggtFromChar(meta, aggtCol[nk]);
      let d = divOf(meta, a, grs);
      const e = exc.get(nk);
      if (e) { if (e[0]) a = e[0]; if (e[1]) d = e[1]; }
      c.aggt = a;
      c.div = d;
    }
    nk++;
    candidates.push(c);
  }

  // summary, overall blocks and facts
  const modes = f.slice(3, 6);
  const pred = predict(meta, { n, nonMarker, absent: num(f[7] || 0), cnt: f[6] ? f[6].split('/').map((x) => x.split(',').map(num)) : [], st, V: (L[7] || '').split(',') });
  if (opts && opts.predictOnly) return pred;
  const raw = L[9] ? JSON.parse(L[9]) : [];
  let summary = null, overall = [], facts = [];
  if (modes[0] === '1') summary = pred.s;
  else if (modes[0] === '2') summary = pred.t;
  else if (modes[0] === 'j') summary = raw[0] && { head: raw[0][0], rows: raw[0][1] };
  if (modes[1] === 'd') overall = pred.o;
  else if (modes[1] === 'j') overall = raw[1];
  if (modes[2] === 'd') facts = pred.f;
  else if (modes[2] === 'j') facts = raw[2];
  if (L[8]) {
    const cells = cellsOf(modes[1] === 'd' ? overall : null, modes[2] === 'd' ? facts : null);
    for (const [i, v] of JSON.parse(L[8])) { const c = cells[i]; c[0][c[1]] = v; }
  }
  return { code: centre, name, sourceUrl, summary, facts, overall, candidates };
}

/**
 * Decode list.json into rows [code, listName, has, region?, district?], sorted by code.
 * Region and district are present when the exam has them (always for primary exams).
 */
export function decodeList(list, kind) {
  const codes = [];
  let prev = null;
  const shape = (c) => { const m = /^([A-Z]+)(\d+)$/.exec(c); return m ? { p: m[1], w: m[2].length, n: +m[2] } : null; };
  for (const t of list.c ? list.c.split(',') : []) {
    if (t[0] === '!') { const c = t.slice(1); codes.push(c); prev = shape(c); }
    else { prev.n += parseInt(t, 36); codes.push(prev.p + String(prev.n).padStart(prev.w, '0')); }
  }
  const stems = codes.length ? list.n.split('\n') : [];
  const idxSet = (s) => new Set((s ? s.split(',') : []).map((x) => parseInt(x, 36)));
  const missing = list.z !== undefined ? idxSet(list.z) : null;
  const present = list.y !== undefined ? idxSet(list.y) : null;
  const runs = (s, dict) => {
    const out = [];
    for (const t of s ? s.split(',') : []) {
      const [a, b] = t.split('*');
      for (let i = 0, k = b ? parseInt(b, 36) : 1; i < k; i++) out.push(dict[parseInt(a, 36)]);
    }
    return out;
  };
  const R = list.r !== undefined ? runs(list.r, list.R) : null;
  const D = list.d !== undefined ? runs(list.d, list.D) : null;
  return codes.map((c, i) => {
    const k = list.k[i];
    const has = present ? present.has(i) : !missing.has(i);
    const row = [c, stems[i] + (k === '-' ? '' : list.x[+k]), has ? 1 : 0];
    if (R) row.push(R[i], D[i]);
    return row;
  });
}

/** The PREM NO of one pupil from the text of a school's .pm file (8 base-36 characters per sequence number; a gap is zeros).
 *  Returns "" when the pupil has none. Written by scripts/tools/results-prem.mjs; the Worker's pages never load it. */
export function unpackPrem(packed, seq) {
  const i = parseInt(String(seq), 10);
  if (!packed || !(i >= 1)) return '';
  const part = packed.slice((i - 1) * 8, i * 8);
  if (part.length < 8) return '';
  const n = parseInt(part, 36);
  return n > 0 ? String(n).padStart(11, '0') : '';
}

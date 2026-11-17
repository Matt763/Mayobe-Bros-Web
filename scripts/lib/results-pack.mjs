// Packs the Results project's centre files into the compact v3 format (decoder: js/results-codec.js; the written format is
// "Data contract (v3)" in docs/superpowers/specs/2026-11-10-results-app-design.md). Pure functions: no file or network access.
//
// Flow for one exam:
//   meta = learnMeta(info, each)            two scans over every parsed centre (each(fn) calls fn(src) per centre)
//   { text } = packCentre(src, meta)        one centre file; summary, overall blocks and facts are stored as "what the rows
//                                           predict" plus patches, or whole when that is not smaller
//   list = packList(kind, rows, has)        the centre list
//   finishMeta(meta, list, total, online)   adds total, online and the version key
//   verifyCentre / verifyList               decode again and compare with the source (an empty array means identical)
import { createHash } from 'node:crypto';
import { CODEC_VERSION, decodeCentre, decodeList, cellsOf, aggtOf, divOf, divKey, wordsOf, subjectChars, charFromAggt, aggtFromChar, DEFAULT_WORDS } from '../../js/results-codec.js';

export { CODEC_VERSION };

const B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const NOT_PASS = new Set(['FAIL', 'FAILED', 'FLD', 'SUPP', 'REFERRED', '0', 'ABS', 'ABSENT']);
const ALIAS = { CREDITS: 'CREDIT', FLD: 'FAIL', 'DIV-I': 'I', 'DIV-II': 'II', 'DIV-III': 'III', 'DIV-IV': 'IV', 'DIV-0': '0' };
/** The aggregate the decoder will read from the column: the value itself, or "-" when it must come from an exception. */
const storedAggt = (meta, a) => (charFromAggt(meta, a) === null ? '-' : a);
const isAbsent = (d) => d === 'ABS' || d === 'ABSENT';
const MAX_SUBJECTS = 62 * 62;
const POINTS = { csee: 'A1B2C3D4F5', acsee: 'A1B2C3D4E5S6F7' };
const PATCH_RATIO = 1.5; // patches are kept while their JSON is at most this times the whole block's JSON

/** How the Results site writes the subjects of one candidate (used to prove nothing is lost). */
export function rawOf(subjects, kind) {
  return kind === 'primary'
    ? subjects.map(([n, g]) => `${n} - ${g}`).join(', ')
    : subjects.map(([n, g]) => `${n} - '${g}'`).join(' ');
}

export function isPairs(subjects) {
  return Array.isArray(subjects) && subjects.length > 0
    && subjects.every((s) => Array.isArray(s) && s.length === 2 && typeof s[0] === 'string' && typeof s[1] === 'string');
}

/**
 * Places of one school's subjects inside the exam's subject list, or null. A primary exam has one list, and a school may take
 * only part of it (some SFNA schools also sit TEHAMA): its subjects must appear in the same order and the last one (Average
 * Grade) must be the list's last. A subject the school does not take is written "." in the grade string.
 */
export function placeInList(names, full) {
  const out = [];
  let q = 0;
  for (const n of names) {
    while (q < full.length && full[q] !== n) q++;
    if (q >= full.length) return null;
    out.push(q++);
  }
  return out.length && out[out.length - 1] === full.length - 1 ? out : null;
}

const J = JSON.stringify;
const fail = (code, msg) => { throw new Error(`${code}: ${msg}`); };

// ---------------------------------------------------------------- learning

function topoOrder(names, edges, count) {
  const indeg = new Map(names.map((n) => [n, 0]));
  for (const set of edges.values()) for (const b of set) indeg.set(b, indeg.get(b) + 1);
  const out = [];
  const ready = names.filter((n) => !indeg.get(n));
  while (ready.length) {
    ready.sort((x, y) => count.get(y) - count.get(x) || (x < y ? -1 : 1));
    const a = ready.shift();
    out.push(a);
    for (const b of edges.get(a) || []) { indeg.set(b, indeg.get(b) - 1); if (!indeg.get(b)) ready.push(b); }
  }
  if (out.length !== names.length) throw new Error('topoOrder: cycle');
  return out;
}

/**
 * One canonical subject order for the exam. When candidates list the same subjects in conflicting orders (a cycle), the
 * subject most candidates take is placed first and the loop goes on; the rows that then disagree with the order are stored
 * as "odd rows" (explicit subject list), so nothing is lost.
 */
function canonicalOrder(names, edges, count, weight) {
  const rest = new Set(names);
  const indeg = new Map(names.map((n) => [n, 0]));
  for (const set of edges.values()) for (const b of set) indeg.set(b, indeg.get(b) + 1);
  const out = [];
  while (rest.size) {
    let ready = [...rest].filter((n) => !indeg.get(n));
    if (!ready.length) {
      // stuck in a loop: put first the subject that most candidates list before the others still waiting
      const score = (a) => { let t = 0; for (const b of rest) if (b !== a) t += (weight.get(a + '\x00' + b) || 0) - (weight.get(b + '\x00' + a) || 0); return t; };
      ready = [[...rest].sort((x, y) => score(y) - score(x) || count.get(y) - count.get(x) || (x < y ? -1 : 1))[0]];
    }
    ready.sort((x, y) => count.get(y) - count.get(x) || (x < y ? -1 : 1));
    const a = ready[0];
    out.push(a);
    rest.delete(a);
    for (const b of edges.get(a) || []) if (rest.has(b)) indeg.set(b, indeg.get(b) - 1);
  }
  return out;
}

const skeleton = (o) => o.map((b) => (b.t === 'h' ? 'h:' + b.v : b.t === 'kv' ? 'kv:' + b.rows.map((r) => r[0]).join('|') : 'g:' + b.head.join('|'))).join('//');

/** Thresholds [[from, label]] ordered by value, from observed (value, label) pairs. */
function levelTable(pairs) {
  const min = new Map();
  for (const [v, l] of pairs) if (Number.isFinite(v) && typeof l === 'string' && l !== '-' && (!min.has(l) || v < min.get(l))) min.set(l, v);
  const t = [...min].sort((a, b) => a[1] - b[1]).map(([l, v]) => [v, l]);
  if (t.length) t[0][0] = 0;
  return t;
}

/**
 * Some old pages (Maktaba, ACSEE 2018/2019, DSEE 2020 to 2022, one CSEE 2023 centre) print NECTA's count line right after the
 * centre name: "KIKARO SECONDARY SCHOOL DIV-I = 9; DIV-II = 41; ..." or "... TEACHERS' COLLEGE DISTINCTION = 0; CREDITS = 250; ...".
 * It is a summary, never part of the name, so it is cut off here. The counts themselves are worked out from the rows.
 */
export function cleanName(name) {
  if (typeof name !== 'string') return name;
  return name.replace(/\s+(?:DIV-[IV0]+|DISTINCTION|CREDITS?|PASS(?:ED)?|SUPP|FLD)\s*=\s*\d.*$/s, '').replace(/[\s;]+$/, '');
}

/**
 * A centre whose page printed no division-by-sex table (the whole of ACSEE 2019, a few ACSEE 2018 centres) gets the same table the
 * other years have, counted from its own candidate rows (sex F/M, division I to IV and 0). Candidates NECTA left ungraded
 * (a printed note instead of grades) are not counted, exactly as in the printed tables. Returns null when the rows do not fit.
 */
export function derivedSummary(src) {
  if (src.summary || !['ACSEE', 'CSEE', 'FTNA'].includes(String(src.category).toUpperCase())) return null;
  const col = { I: 0, II: 1, III: 2, IV: 3, 0: 4 };
  const cnt = { F: [0, 0, 0, 0, 0], M: [0, 0, 0, 0, 0] };
  let graded = 0;
  for (const c of src.candidates) {
    const k = col[String(c.div).trim()];
    if (k === undefined) continue;
    if (!cnt[c.sex]) return null;
    cnt[c.sex][k]++; graded++;
  }
  if (!graded) return null;
  const rows = [['F', ...cnt.F], ['M', ...cnt.M], ['T', ...cnt.F.map((x, k) => x + cnt.M[k])]].map((r) => r.map(String));
  return { head: ['SEX', 'I', 'II', 'III', 'IV', '0'], rows };
}

/** Frequent trailing words of the names (" SECONDARY SCHOOL"), longest saving first. */
export function nameSuffixes(names, max) {
  const cnt = new Map();
  for (const n of names) {
    const w = n.split(' ');
    for (let k = 1; k <= 3 && k < w.length; k++) { const s = ' ' + w.slice(-k).join(' '); cnt.set(s, (cnt.get(s) || 0) + 1); }
  }
  const picked = [];
  for (const [s, c] of [...cnt].sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)) {
    if (c < 20) break;
    if (picked.some((p) => p.endsWith(s) || s.endsWith(p))) continue;
    picked.push(s);
    if (picked.length >= max) break;
  }
  return picked;
}

/**
 * Everything the files of one exam share. `info` = { exam, cat, year, kind, verified }. `each(fn)` must call fn(src) for every
 * parsed centre of the exam (it is called twice). The result is the meta.json object (without total, online and key).
 */
export function learnMeta(info, each) {
  const { cat, kind } = info;
  const primary = kind === 'primary';
  const pts = POINTS[cat] || POINTS.csee;
  const P = {};
  for (let i = 0; i < pts.length; i += 2) P[pts[i]] = +pts[i + 1];

  const weight = new Map();
  const count = new Map(), edges = new Map(), regions = new Set(), allNames = [];
  const urls = new Map(), widths = new Map(), skels = new Map(), fkeys = new Map();
  const ruleOk = { 3: 0, 7: 0 }, psVotes = {}, smVotes = new Map(), recs = [];
  const lvPairs = [], lfPairs = [];
  let nGraded = 0, gpaSeen = false;
  const lists = [], listIds = new Map(), dictRaw = new Map();
  const divSeen = new Map();
  let tplO = null, tplF = null, tplS = null;

  each((src) => {
    if (src.kind !== kind) fail(src.code, `kind ${src.kind} in a ${kind} exam`);
    allNames.push(src.name);
    const lower = src.code.toLowerCase();
    if (src.sourceUrl.split(lower).length === 2) { const t = src.sourceUrl.replace(lower, '{c}'); urls.set(t, (urls.get(t) || 0) + 1); }
    if (src.summary && (!tplS || src.summary.rows.length >= tplS.labels.length)) tplS = { head: src.summary.head, labels: src.summary.rows.map((r) => r[0]) };
    if (!primary) for (const c of src.candidates) { divSeen.set(c.div, (divSeen.get(c.div) || 0) + 1); if (/^\d+\.\d+$/.test(c.aggt)) gpaSeen = true; }
    for (const c of src.candidates) { const m = /^\d+$/.test(c.cno.slice(src.code.length + 1)) ? c.cno.length - src.code.length - 1 : 0; if (m) widths.set(m, (widths.get(m) || 0) + 1); }
    const graded = src.candidates.filter((c) => isPairs(c.subjects));
    if (primary) {
      for (const c of graded) {
        const names = c.subjects.map((s) => s[0]);
        if (c.subjects.some((s) => s[1].length !== 1 || s[1] === '.')) fail(c.cno, 'primary grade');
        const lk = names.join('\n');
        let li = listIds.get(lk);
        if (li === undefined) { li = lists.length; listIds.set(lk, li); lists.push({ names, cno: c.cno }); }
        const dk = li + ':' + c.subjects.map((s) => s[1]).join('');
        dictRaw.set(dk, (dictRaw.get(dk) || 0) + 1);
      }
    } else {
      for (const c of graded) {
        const names = c.subjects.map((s) => s[0]);
        names.forEach((n, i) => {
          count.set(n, (count.get(n) || 0) + 1);
          if (!edges.has(n)) edges.set(n, new Set());
          if (i) { edges.get(names[i - 1]).add(n); const wk = names[i - 1] + '\x00' + n; weight.set(wk, (weight.get(wk) || 0) + 1); }
        });
        const p = c.subjects.map((s) => P[s[1]]).filter(Boolean).sort((a, b) => a - b);
        for (const k of [3, 7]) {
          const a = p.length >= k ? String(p.slice(0, k).reduce((x, y) => x + y, 0)) : '-';
          if (a === c.aggt) ruleOk[k]++;
        }
        nGraded++;
      }
    }
    if (src.overall && src.overall.length) {
      const sg = skeleton(src.overall);
      skels.set(sg, (skels.get(sg) || 0) + 1);
      if (!tplO || skels.get(sg) > (skels.get(skeleton(tplO)) || 0)) tplO = clone(src.overall);
      if (!primary) {
        const kv = src.overall.find((b) => b.t === 'kv');
        if (kv && kv.rows[0]) regions.add(kv.rows[0][1]);
        const g6 = src.overall.find((b) => b.t === 'grid' && b.head[0] === 'CODE');
        if (g6) {
          const st = new Map();
          for (const c of graded) {
            for (const [n, g] of c.subjects) {
              let o = st.get(n);
              if (!o) st.set(n, o = { reg: 0, x: 0, gc: {} });
              o.reg++;
              o.gc[g] = (o.gc[g] || 0) + 1;
              if (g === 'X') o.x++;
            }
          }
          const hasLevel = g6.head[9] === 'COMPENTENCY LEVEL';
          if (g6.rows.length === st.size) recs.push({ rows: g6.rows.map((r) => [r[0], r[1], r[2], r[6]]), st: [...st].map(([n, o]) => [n, o.reg, o.reg - o.x]) });
          for (const r of g6.rows) {
            if (hasLevel) lvPairs.push([+r[8], r[9]]);
            const cand = [...st].filter(([, o]) => String(o.reg) === r[2] && String(o.reg - o.x) === r[6]);
            if (cand.length !== 1 || g6.rows.length !== st.size) continue;
            const v = smVotes.get(cand[0][0]) || new Map();
            const key = r[0] + '\t' + r[1];
            v.set(key, (v.get(key) || 0) + 1);
            smVotes.set(cand[0][0], v);
            if (hasLevel) {
              for (let len = 3; len <= 6; len++) {
                let t = 0;
                for (const ch of 'ABCDESF'.slice(0, len)) t += cand[0][1].gc[ch] || 0;
                if (String(t) === r[7]) psVotes[len] = (psVotes[len] || 0) + 1;
              }
            }
          }
        }
      } else {
        const g = src.overall.find((b) => b.t === 'grid');
        if (g) for (const r of g.rows) lvPairs.push([+r[7], r[8]]);
      }
    }
    if (src.facts && src.facts.length) {
      const fk = src.facts.map((r) => r[0]).join('|');
      fkeys.set(fk, (fkeys.get(fk) || 0) + 1);
      if (!tplF || fkeys.get(fk) >= (fkeys.get(tplF.map((r) => r[0]).join('|')) || 0)) tplF = clone(src.facts);
      if (src.facts[1] && src.facts[2] && src.facts[2][0] === 'DARAJA') lfPairs.push([+src.facts[1][1], src.facts[2][1]]);
    }
  });

  // the exam's subject list is the fullest list any school has; every other school's list must be part of it
  let primaryNames = null;
  const dict = new Map();
  if (primary && lists.length) {
    let full = lists[0];
    for (const l of lists) if (l.names.length > full.names.length) full = l;
    primaryNames = full.names;
    const where = lists.map((l) => {
      const p = placeInList(l.names, primaryNames);
      if (!p) fail(l.cno, `subjects differ from the fixed list: ${l.names.join(', ')} (every school's list must be part of the fullest one: ${primaryNames.join(', ')})`);
      return p;
    });
    for (const [k, n] of dictRaw) {
      const i = k.indexOf(':');
      const a = new Array(primaryNames.length).fill('.');
      const g = k.slice(i + 1);
      where[+k.slice(0, i)].forEach((pos, j) => { a[pos] = g[j]; });
      const e = a.join('');
      dict.set(e, (dict.get(e) || 0) + n);
    }
  }

  const mostCommon = (m, d) => (m.size ? [...m].sort((a, b) => b[1] - a[1])[0][0] : d);
  const meta = {
    v: CODEC_VERSION, exam: info.exam, cat, year: info.year, kind, verified: info.verified,
    sw: mostCommon(widths, 4), ut: mostCommon(urls, ''), sx: ['F', 'M'], pts, nc: ['', ...nameSuffixes(allNames, 7)],
  };
  if (primary) {
    meta.subjects = primaryNames || [];
    const sorted = [...dict].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const a = 40;
    let c3 = Math.max(0, Math.ceil((sorted.length - a - 20 * 62) / 3844));
    // the estimate above ignores that every three-character lead takes one two-character lead from the 62 - a - c3 that are left: count what the codes really hold
    while (c3 <= 22 && a + (62 - a - c3) * 62 + c3 * 3844 < sorted.length) c3++;
    if (c3 > 22) fail(info.exam, 'the grade dictionary is too large for the code');
    meta.vc = [a, 62 - a - c3];
    meta.pd = sorted.join('');
    meta.lv = levelTable(lvPairs);
    meta.lf = levelTable(lfPairs);
  } else {
    const names = canonicalOrder([...count.keys()], edges, count, weight);
    if (names.length > MAX_SUBJECTS) fail(info.exam, `${names.length} subjects do not fit in two base62 digits`);
    meta.subjects = names;
    if (names.length > 62) meta.sd = 2;
    // code and full name of each subject, from the overall tables: unique matches first, then elimination
    const known = new Map();
    for (const [n, v] of smVotes) known.set(n, [...v].sort((a, b) => b[1] - a[1])[0][0]);
    for (let again = true; again;) {
      again = false;
      const used = new Set(known.values());
      for (const r of recs) {
        const unk = r.st.filter(([n]) => !known.has(n));
        const rows = r.rows.filter((x) => !used.has(x[0] + '\t' + x[1]));
        if (!unk.length || unk.length !== rows.length) continue;
        for (const [n, reg, clean] of unk) {
          const m2 = [...new Set(rows.filter((x) => +x[2] === reg && +x[3] === clean).map((x) => x[0] + '\t' + x[1]))];
          if (m2.length === 1 && (unk.length === 1 || unk.filter(([, g, c]) => g === reg && c === clean).length === 1)) { known.set(n, m2[0]); used.add(m2[0]); again = true; }
        }
      }
    }
    meta.sm = names.map((n) => (known.has(n) ? known.get(n).split('\t') : ['', n]));
    meta.regions = [...regions].sort();
    if (gpaSeen) meta.gs = 10;
    // division words: the summary's own columns first, then any other word candidates carry
    let words = tplS ? tplS.head.slice(1).map((w) => ALIAS[w] || w) : [];
    if (!words.length || words.every((w) => DEFAULT_WORDS.includes(w))) words = ['I', 'II', 'III', 'IV'].some((w) => divSeen.has(w)) || tplS ? DEFAULT_WORDS.slice() : [];
    for (const w of [...divSeen.keys()].sort()) if (/^[A-Z]{2,}$/.test(w) && !isAbsent(w) && !words.includes(w)) words.push(w);
    const base = words.length >= 2 ? words : DEFAULT_WORDS;
    if (base.join('|') !== DEFAULT_WORDS.join('|')) {
      meta.dw = base;
      const firstBad = base.findIndex((w) => NOT_PASS.has(w));
      meta.dp = firstBad < 0 ? base.length : firstBad;
    }
    const best = ruleOk[7] >= ruleOk[3] ? 7 : 3;
    meta.rule = nGraded && ruleOk[best] / nGraded >= 0.99 ? best : 0;
    const votes = Object.entries(psVotes).sort((a, b) => b[1] - a[1]);
    meta.ps = votes.length ? 'ABCDESF'.slice(0, +votes[0][0]) : (cat === 'acsee' ? 'ABCDES' : 'ABCD');
    meta.lv = levelTable(lvPairs);
    meta.dv = {};
    const tally = new Map();
    each((src) => {
      for (const c of src.candidates) {
        if (!isPairs(c.subjects)) continue;
        const grs = c.subjects.map((s) => s[1]);
        const key = divKey(meta, meta.rule ? aggtOf(meta, grs) : storedAggt(meta, c.aggt), grs);
        const t = tally.get(key) || new Map();
        t.set(c.div, (t.get(c.div) || 0) + 1);
        tally.set(key, t);
      }
    });
    for (const [k, t] of tally) meta.dv[k] = mostCommon(t, '');
  }
  // block templates: the most common shape, with the data blanked
  let tplOut = null;
  if (tplO) {
    tplOut = clone(tplO);
    for (const b of tplOut) {
      if (b.t === 'kv') b.rows.forEach((r) => { r[1] = ''; });
      if (b.t === 'grid') b.rows = primary ? b.rows.map((r) => [r[0], r[1]]) : [];
    }
  }
  meta.tpl = { s: tplS ? { head: tplS.head, labels: [...tplS.labels] } : null, o: tplOut, f: tplF ? tplF.map((r) => [r[0], '']) : null };
  return meta;
}

const clone = (x) => JSON.parse(J(x));

// ---------------------------------------------------------------- one centre

const rle = (a) => {
  let o = '', i = 0;
  while (i < a.length) { let j = i; while (j < a.length && a[j] === a[i]) j++; o += a[i] + (j - i); i = j; }
  return o;
};

function seqSpec(seq, width) {
  if (!seq.every((s) => /^\d+$/.test(s) && s.length === width)) return 'l' + seq.join(',');
  const nums = seq.map(Number);
  const r = [];
  let s = nums[0], p = s;
  for (let i = 1; i < nums.length; i++) { if (nums[i] !== p + 1) { r.push(s === p ? s : s + '-' + p); s = nums[i]; } p = nums[i]; }
  if (nums.length) r.push(s === p ? s : s + '-' + p);
  return r.length === 1 && nums[0] === 1 ? '' : 'r' + r.join(',');
}

const shapeOf = (o, f) => J([(o || []).map((b) => (b.t === 'h' ? 'h' : b.t === 'kv' ? 'kv' + b.rows.length : 'g' + b.head.length + 'x' + b.rows.length + ':' + b.rows.map((r) => r.length).join(''))), (f || []).length]);

const dictCache = new WeakMap();
function dictIndex(meta) {
  if (!dictCache.has(meta)) {
    const S = meta.subjects.length;
    const m = new Map();
    for (let i = 0; i * S < meta.pd.length; i++) m.set(meta.pd.substr(i * S, S), i);
    dictCache.set(meta, m);
  }
  return dictCache.get(meta);
}

/** Pack one centre. Returns { text, stats } (stats: patches, modes, exceptions; used by tests and the summary). */
export function packCentre(src, meta) {
  const primary = meta.kind === 'primary';
  const sep = primary ? '-' : '/';
  const code = src.code;
  const cands = src.candidates;
  const S = meta.subjects.length;
  // the number separator: the exam's own, or the other one when every number of the centre uses it, else whole numbers
  let sepUsed = sep;
  if (!cands.every((c) => c.cno.startsWith(code + sep))) {
    const other = sep === '-' ? '/' : '-';
    sepUsed = cands.every((c) => c.cno.startsWith(code + other)) ? other : '*';
  }
  const seq = cands.map((c) => {
    const s = sepUsed === '*' ? c.cno : c.cno.slice(code.length + 1);
    if (/[\n,;]/.test(s)) fail(c.cno, 'bad sequence');
    return s;
  });
  const sexes = cands.map((c) => { if (!c.sex || !/^[A-Z]$/.test(c.sex) || meta.sx.indexOf(c.sex) < 0) fail(c.cno, `sex ${J(c.sex)}`); return c.sex; });
  const markers = [], rowsIdx = [], oddRows = [];
  const posOf = new Map(meta.subjects.map((nm, i) => [nm, i]));
  const inOrder = (c) => { let prev = -1; return c.subjects.every(([nm]) => { const p = posOf.get(nm); const ok = p !== undefined && p > prev; prev = p; return ok; }); };
  cands.forEach((c, i) => {
    if (isPairs(c.subjects) && !primary && !inOrder(c)) {
      for (const v of [c.aggt, c.div]) if (typeof v !== 'string' || /[\n\t\x1f]/.test(v)) fail(c.cno, 'bad aggt/div');
      const enc = c.subjects.map(([nm, g]) => { if (posOf.get(nm) === undefined || g.length !== 1 || /[\n\t\x1f]/.test(g)) fail(c.cno, `subject ${nm}`); return subjectChars(posOf.get(nm), meta.sd) + g; }).join('');
      oddRows.push([i, c.aggt, c.div, enc].join('\t'));
      return;
    }
    if (isPairs(c.subjects)) { rowsIdx.push(i); return; }
    if (Array.isArray(c.subjects) && c.subjects.length) fail(c.cno, 'subjects are not pairs');
    if (typeof c.subjectsRaw !== 'string' || /[\n\x1f]/.test(c.subjectsRaw)) fail(c.cno, 'bad note');
    if (!primary) for (const v of [c.aggt, c.div]) if (typeof v !== 'string' || /[\n\t\x1f]/.test(v)) fail(c.cno, 'bad aggt/div');
    markers.push(primary ? i + '\t' + c.subjectsRaw : [i, c.aggt, c.div, c.subjectsRaw].join('\t'));
  });
  if (/[\n\x01]/.test(src.name)) fail(code, 'the name has a line break or \\x01');
  let k = 0;
  for (let q = 1; q < meta.nc.length; q++) if (src.name.endsWith(meta.nc[q]) && src.name.length > meta.nc[q].length && meta.nc[q].length > meta.nc[k].length) k = q;
  const cls = (k + ':' + src.name.slice(0, src.name.length - meta.nc[k].length)).replace(/;/g, '\x01');
  const urlLit = src.sourceUrl === meta.ut.replace('{c}', code.toLowerCase()) ? '' : src.sourceUrl;
  if (/[\n\x01]/.test(urlLit)) fail(code, 'bad URL');
  const codeLit = code === code.toLowerCase().toUpperCase() ? '' : code; // the decoder is given the capitals of the file name

  let local = '', grid = '', aggtCol = '', keptPos = [];
  const exc = [];
  const words = wordsOf(meta);
  const cnt = [words.map(() => 0), words.map(() => 0)];
  let absent = 0;
  const xs = new Array(Math.max(0, S - 1)).fill(0);
  if (primary) {
    const [va, vb] = meta.vc;
    const vcode = (i) => {
      if (i < va) return B[i];
      i -= va;
      if (i < vb * 62) return B[va + Math.floor(i / 62)] + B[i % 62];
      i -= vb * 62;
      return B[va + vb + Math.floor(i / 3844)] + B[Math.floor(i / 62) % 62] + B[i % 62];
    };
    const di = dictIndex(meta);
    const out = [];
    const seen = new Array(S).fill(false);
    for (const i of rowsIdx) {
      const s = cands[i].subjects;
      const at = placeInList(s.map((x) => x[0]), meta.subjects);
      if (!at || s.some((x) => x[1].length !== 1 || x[1] === '.')) fail(cands[i].cno, 'primary subjects');
      const a = new Array(S).fill('.');
      at.forEach((pos, j) => { a[pos] = s[j][1]; seen[pos] = true; });
      const g = a.join('');
      const d = di.get(g);
      if (d === undefined) fail(cands[i].cno, 'grades not in the dictionary');
      out.push(vcode(d));
      for (let q = 0; q < xs.length; q++) if (g[q] === 'X') xs[q]++;
      const gi = 'ABCDE'.indexOf(g[S - 1]);
      if (gi >= 0) cnt[meta.sx.indexOf(cands[i].sex)][gi]++;
    }
    grid = out.join('');
    keptPos = [];
    for (let q = 0; q < S - 1; q++) if (!rowsIdx.length || seen[q]) keptPos.push(q);
  } else {
    const pos = new Map(meta.subjects.map((s, i) => [s, i]));
    const set = new Set();
    const parsed = rowsIdx.map((i) => {
      const c = cands[i];
      let prev = -1;
      return c.subjects.map(([nm, g]) => {
        const p = pos.get(nm);
        if (p === undefined || p <= prev || g.length !== 1 || g === '.' || /[\n]/.test(g)) fail(c.cno, `subject order or grade at ${nm}`);
        prev = p;
        set.add(p);
        return [p, g];
      });
    });
    const Lk = [...set].sort((a, b) => a - b);
    const lp = new Map(Lk.map((s, i) => [s, i]));
    local = Lk.map((s) => subjectChars(s, meta.sd)).join('');
    grid = parsed.map((a) => { const r = new Array(Lk.length).fill('.'); for (const [s, g] of a) r[lp.get(s)] = g; return r.join(''); }).join('');
    rowsIdx.forEach((i, q) => {
      const c = cands[i];
      const grs = parsed[q].map((x) => x[1]);
      const pa = meta.rule ? aggtOf(meta, grs) : storedAggt(meta, c.aggt);
      const pd = divOf(meta, pa, grs);
      if (!meta.rule) aggtCol += charFromAggt(meta, c.aggt) ?? '-';
      const ea = c.aggt !== pa ? c.aggt : '';
      const ed = c.div !== pd ? c.div : '';
      if (ea || ed) { if (/[,;\n]/.test(ea + ed)) fail(c.cno, 'bad aggt/div'); exc.push(q + ',' + ea + ',' + ed); }
    });
    for (const c of cands) {
      const dk = words.indexOf(c.div);
      if (dk >= 0) cnt[meta.sx.indexOf(c.sex)][dk]++;
      if (isAbsent(c.div) || (!isPairs(c.subjects) && c.subjectsRaw === 'ABS')) absent++; // NECTA writes ABS in the subjects cell for FTNA absentees
    }
  }

  // numbers that cannot be derived
  const o = src.overall && src.overall.length ? src.overall : null;
  let V = [];
  if (o) {
    if (primary) {
      const g = o.find((b) => b.t === 'grid');
      V = keptPos.map((q, i) => {
        const c = rowsIdx.length - xs[q];
        const r = g && g.rows[i];
        const m = c && r ? Math.round(+r[7] * c) : 0;
        return String(Number.isFinite(m) ? m : 0);
      });
    } else {
      const kv = o.find((b) => b.t === 'kv');
      const ri = kv ? meta.regions.indexOf(kv.rows[0][1]) : -1;
      V = [ri < 0 ? '' : String(ri), kv && kv.rows[2] ? String(kv.rows[2][1]).split(' ')[0] : '0'];
      if (V[1].includes(',') || V[1].includes('\n')) V[1] = '0';
    }
  }

  const sepLit = sepUsed === sep ? '' : sepUsed;
  const head = [seqSpec(seq, meta.sw), cls, urlLit.replace(/;/g, '\x01'), 'x', 'x', 'x', cnt.map((c) => c.join(',')).join('/'), absent, codeLit];
  if (sepLit) head.push(sepLit);
  const lines = [head.join(';'), rle(sexes), markers.join('\x1f'), local, grid, aggtCol, exc.join(';'), V.join(','), '', ''];
  if (oddRows.length) lines.push(oddRows.join('\x1f'));
  const pred = decodeCentre(lines.join('\n'), meta, code.toUpperCase(), { predictOnly: true });

  // summary, overall blocks and facts: derived with patches when that works, whole otherwise
  const raw = [null, null, null];
  let sMode, oMode = '', fMode = '', patches = [];
  if (!src.summary) sMode = '0';
  else if (pred.s && J(pred.s) === J({ head: src.summary.head, rows: src.summary.rows })) sMode = '1';
  else if (pred.t && J(pred.t) === J({ head: src.summary.head, rows: src.summary.rows })) sMode = '2';
  else { sMode = 'j'; raw[0] = [src.summary.head, src.summary.rows]; }
  const fsrc = src.facts && src.facts.length ? src.facts : null;
  if (o || fsrc) {
    if (o) { if (pred.o && shapeOf(pred.o) === shapeOf(o)) oMode = 'd'; else { oMode = 'j'; raw[1] = o; } }
    if (fsrc) { if (pred.f && shapeOf(null, pred.f) === shapeOf(null, fsrc)) fMode = 'd'; else { fMode = 'j'; raw[2] = fsrc; } }
    const cp = cellsOf(oMode === 'd' ? pred.o : null, fMode === 'd' ? pred.f : null);
    const cs = cellsOf(oMode === 'd' ? o : null, fMode === 'd' ? fsrc : null);
    cp.forEach((c, i) => { const w = cs[i][0][cs[i][1]]; if (c[0][c[1]] !== w) patches.push([i, w]); });
    if ((oMode === 'd' || fMode === 'd') && J(patches).length > J([o, fsrc]).length * PATCH_RATIO) {
      if (oMode === 'd') { oMode = 'j'; raw[1] = o; }
      if (fMode === 'd') { fMode = 'j'; raw[2] = fsrc; }
      patches = [];
    }
  }
  head[3] = sMode; head[4] = oMode; head[5] = fMode;
  lines[0] = head.join(';');
  lines[8] = patches.length ? J(patches) : '';
  lines[9] = raw.some((x) => x) ? J(raw) : '';
  return { text: lines.join('\n'), stats: { patches: patches.length, sMode, oMode, fMode, exceptions: exc.length } };
}

// ---------------------------------------------------------------- list and meta

const b36 = (n) => n.toString(36);
const codeShape = (c) => { const m = /^([A-Z]+)(\d+)$/.exec(c); return m ? { p: m[1], w: m[2].length, n: +m[2] } : null; };

function runIds(values) {
  const dict = [...new Set(values)];
  const id = new Map(dict.map((v, i) => [v, i]));
  const out = [];
  for (let i = 0; i < values.length;) {
    let j = i;
    while (j < values.length && values[j] === values[i]) j++;
    out.push(b36(id.get(values[i])) + (j - i > 1 ? '*' + b36(j - i) : ''));
    i = j;
  }
  return { dict, runs: out.join(',') };
}

/**
 * The centre list. rows = [[code, listName, has, region?, district?]]; `has` is 1 only when a centre file exists.
 * Region and district are written when the exam is primary or any row has one.
 */
export function packList(kind, rows, hasFile) {
  const sorted = [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const names = sorted.map((r) => r[1]);
  if (names.some((n) => typeof n !== 'string' || n.includes('\n'))) throw new Error('a centre name in the list is not a single line of text');
  const sfx = nameSuffixes(names, 8);
  const stems = [], kind2 = [];
  for (const n of names) {
    const k = sfx.findIndex((s) => n.endsWith(s) && n.length > s.length);
    stems.push(k < 0 ? n : n.slice(0, -sfx[k].length));
    kind2.push(k < 0 ? '-' : String(k));
  }
  const codes = [];
  let prev = null;
  for (const r of sorted) {
    const m = codeShape(r[0]);
    if (m && prev && prev.p === m.p && prev.w === m.w && m.n > prev.n) codes.push(b36(m.n - prev.n));
    else codes.push('!' + r[0]);
    prev = m;
  }
  const missing = [], present = [];
  sorted.forEach((r, i) => (hasFile(r[0]) ? present : missing).push(i));
  const list = { c: codes.join(','), x: sfx, k: kind2.join(''), n: stems.join('\n') };
  if (missing.length <= present.length) list.z = missing.map(b36).join(','); else list.y = present.map(b36).join(',');
  if (kind === 'primary' || sorted.some((r) => r[3] || r[4])) {
    const reg = runIds(sorted.map((r) => r[3] || ''));
    const dis = runIds(sorted.map((r) => r[4] || ''));
    list.R = reg.dict; list.r = reg.runs; list.D = dis.dict; list.d = dis.runs;
  }
  return list;
}

/** Short version key of an exam's meta + list: first 10 hex of the sha1 of their content without the `key` field. */
export function metaKey(meta, list) {
  const { key, ...rest } = meta; // eslint-disable-line no-unused-vars
  return createHash('sha1').update(J(rest)).update(J(list)).digest('hex').slice(0, 10);
}

/** Adds total, online and key to a meta object. */
export function finishMeta(meta, list, total, online) {
  meta.total = total;
  meta.online = online;
  meta.key = metaKey(meta, list);
  return meta;
}

// ---------------------------------------------------------------- proof

/** Decode a packed centre and compare with the source. Returns a list of problems (empty = identical). */
export function verifyCentre(src, text, meta) {
  const bad = [];
  const code = src.code;
  let d;
  try { d = decodeCentre(text, meta, code.toUpperCase()); } catch (e) { return [`${code}: decode failed: ${e.message}`]; }
  const primary = meta.kind === 'primary';
  if (d.code !== code) bad.push(`${code}: code`);
  if (d.name !== src.name) bad.push(`${code}: name`);
  if (d.sourceUrl !== src.sourceUrl) bad.push(`${code}: sourceUrl`);
  if (J(d.summary) !== J(src.summary ? { head: src.summary.head, rows: src.summary.rows } : null)) bad.push(`${code}: summary`);
  if (J(d.facts) !== J(src.facts || [])) bad.push(`${code}: facts`);
  if (J(d.overall) !== J(src.overall || [])) bad.push(`${code}: overall`);
  if (d.candidates.length !== src.candidates.length) { bad.push(`${code}: candidate count`); return bad; }
  src.candidates.forEach((s, i) => {
    const c = d.candidates[i];
    const why = [];
    if (c.cno !== s.cno) why.push('cno');
    if (c.sex !== s.sex) why.push('sex');
    if (!primary) {
      if (c.aggt !== s.aggt) why.push('aggt');
      if (c.div !== s.div) why.push('div');
    } else if ('aggt' in c || 'div' in c) why.push('extra fields');
    if (J(c.subjects) !== J(s.subjects)) why.push('subjects');
    if (!isPairs(s.subjects)) { if (c.note !== s.subjectsRaw) why.push('note'); }
    else {
      if ('note' in c) why.push('unexpected note');
      if (rawOf(c.subjects, meta.kind) !== s.subjectsRaw) why.push('subjectsRaw');
      if (primary && c.grade !== s.subjects[s.subjects.length - 1][1]) why.push('grade');
    }
    if (why.length) bad.push(`${s.cno}: ${why.join(', ')}`);
  });
  return bad;
}

/** Decode the list and compare with the rows it was made from. */
export function verifyList(kind, rows, list, hasFile) {
  const dec = decodeList(list, kind);
  const sorted = [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const geo = 'r' in list;
  const bad = [];
  if (dec.length !== sorted.length) bad.push(`list has ${dec.length} rows, expected ${sorted.length}`);
  sorted.forEach((r, i) => {
    const want = [r[0], r[1], hasFile(r[0]) ? 1 : 0];
    if (geo) want.push(r[3] || '', r[4] || '');
    if (J(want) !== J(dec[i])) bad.push(`list row ${r[0]}`);
  });
  return bad;
}

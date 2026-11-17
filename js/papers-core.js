// Past papers: the data logic of the search bar under the "Examination Past Papers" hero. Pure (no DOM, no network), so the build (Node) and the
// browser use the same code and a test can run it. Ported from the owner's papers project (papers-core.js) and shaped for this site's index.
//
// Index (data/papers-index.json, written by scripts/build.mjs from content/papers-manifest.json):
//   { v: 1, e: [[examId, ABBR, "Form Four", groupId?], ...], g: { groupId: "Group name" }?, s: [subjectName, ...],
//     r: [[examIndex, year, subjectIndex, chip, paperId, paperPages, solutionId, solutionPages, originalScanId], ...] }
// A missing file is "" and a missing page count is 0. Ids are the 16-character file names of the PDFs.

export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
export const cmp = (a, b) => collator.compare(a, b);
// What the Level list adds after an exam's name, so the reader knows who sat it (owner's request 2026-11-12). Only the list: titles and results keep the plain name.
export const LEVEL_NOTE = { psle: 'Standard 7', ftna: 'Form 2', csee: 'Form 4', acsee: 'Form 6', qt: 'Private' };
export const levelLabel = (id, name) => (LEVEL_NOTE[id] ? `${name} (${LEVEL_NOTE[id]})` : name);
// The choices of the Level list, in order: "All levels", then each group as a heading you can choose itself (O-Level) with its exams under it (FTNA, CSEE, QT).
// A group with one exam is one choice ("A-Level · ACSEE (Form 6)"), so nothing is said twice. Used by the build (f = null: no counts) and by the browser
// (f = facets(): counts, and exams with nothing for the other choices are left out unless chosen). Each: { value, label, cls: all | head | item | solo, count }.
export function levelChoices(levels, groups, f, current = '') {
  const cnt = (id) => (f ? f.level.get(id) || 0 : null);
  const show = (l) => !f || cnt(l.id) > 0 || l.id === current;
  const out = [{ value: '', label: 'All levels', cls: 'all', count: f ? [...f.level.values()].reduce((a, b) => a + b, 0) : null }];
  for (const l of levels) if (!l.group && show(l)) out.push({ value: l.id, label: levelLabel(l.id, l.name), cls: 'solo', count: cnt(l.id) });
  for (const g of Object.keys(groups)) {
    const inG = levels.filter((l) => l.group === g && show(l));
    if (!inG.length) continue;
    if (inG.length === 1) { out.push({ value: inG[0].id, label: `${groups[g]} · ${levelLabel(inG[0].id, inG[0].name)}`, cls: 'head', count: cnt(inG[0].id) }); continue; }
    out.push({ value: g, label: groups[g], cls: 'head', count: f ? f.group.get(g) || 0 : null });
    for (const l of inG) out.push({ value: l.id, label: levelLabel(l.id, l.name), cls: 'item', count: cnt(l.id) });
  }
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: groups[current] || levels.find((l) => l.id === current)?.name || current, cls: 'solo', count: 0 });
  return out;
}

/** "Physics" + "Paper 1" -> "Physics Paper 1"; "Paper" -> "Physics"; a chip that already names the subject is used alone (and a chip the subject already carries is left out). */
export function titleOf(subject, chip) {
  const c = String(chip || '').trim();
  if (!c || c === 'Paper') return subject;
  const fc = fold(c), fs = fold(subject);
  if (fs.includes(fc)) return subject;
  const names = String(subject).split('/').map(fold).filter((n) => n.length >= 4);
  if (names.some((n) => fc.includes(n))) return c;
  const lead = fc.split(' ')[0];
  if (lead.length >= 5 && names.some((n) => n.split(' ')[0] === lead)) return c;
  return `${subject}${/^(paper|practical|alternative|assessment|theory|oral|checklist|advanced)\b/i.test(c) ? ' ' : ' – '}${c}`;
}

/** index.json -> { levels, records }. One record per row that has a paper or a solution. */
export function decodeIndex(ix) {
  if (!ix || ix.v !== 1 || !Array.isArray(ix.r)) throw new Error('Unsupported past-papers index');
  const levels = ix.e.map(([id, name, who, group], order) => ({ id, name, who, group: group || '', order }));
  const groups = ix.g || {};
  const records = ix.r.map((row, i) => {
    const [L, year, Si, chip, paper, pages, solution, solPages, original] = row;
    const lv = levels[L], subjectName = ix.s[Si];
    const title = titleOf(subjectName, chip);
    return {
      i, level: lv.id, group: lv.group, levelName: lv.name, levelOrder: lv.order, year, subject: Si, subjectName, chip, title,
      paper: paper || '', pages: pages || 0, solution: solution || '', solPages: solPages || 0, original: original || '',
      hay: fold(`necta ${lv.name} ${lv.who} ${year} ${subjectName} ${chip}`), nameF: fold(subjectName),
    };
  });
  return { levels, groups, records };
}

/** 0 exact subject, 1 subject prefix, 2 every word starts a word, 3 every word is somewhere in the text; Infinity = no match. */
const LEVEL_WORDS = new Set(['csee', 'acsee', 'psle', 'ftna', 'gatce', 'dsee', 'dtee']);
export function score(r, q) {
  const f = fold(q);
  if (!f) return 0;
  if (r.nameF === f) return 0;
  if (r.nameF.startsWith(f)) return 1;
  const toks = f.split(' ');
  // an exam's own name in the text means that exam ("csee" must not bring ACSEE papers because the letters are inside the word)
  if (toks.some((t) => LEVEL_WORDS.has(t) && t !== r.level)) return Infinity;
  const words = r.hay.split(' ');
  if (toks.every((t) => words.some((w) => w.startsWith(t)))) return 2;
  if (toks.every((t) => r.hay.includes(t))) return 3;
  return Infinity;
}

// st.level is an exam id ("csee") or a group id ("teachers" = every Teachers Education exam)
const keep = (r, st, skip) => (skip === 'level' || !st.level || r.level === st.level || r.group === st.level)
  && (skip === 'subject' || st.subject === '' || st.subject == null || r.subject === Number(st.subject))
  && (skip === 'year' || !st.year || String(r.year) === String(st.year));

export const byDefault = (a, b) => b.year - a.year || a.levelOrder - b.levelOrder || cmp(a.subjectName, b.subjectName) || cmp(a.chip, b.chip);

/** Records that match every filter and the free text, best match first, then newest year. */
export function search(recs, st) {
  const res = [];
  for (const r of recs) {
    if (!keep(r, st)) continue;
    const s = st.q ? score(r, st.q) : 0;
    if (s !== Infinity) res.push([s, r]);
  }
  res.sort((a, b) => a[0] - b[0] || byDefault(a[1], b[1]));
  return res.map((x) => x[1]);
}

/**
 * Cascading options: each list is counted with every OTHER filter applied, so the level, subject and year lists only offer values that still
 * have results, with their counts.
 */
export function facets(recs, st) {
  const level = new Map(), group = new Map(), subject = new Map(), year = new Map();
  const qs = st.q ? new Map() : null;
  const okQ = (r) => { if (!qs) return true; if (!qs.has(r)) qs.set(r, score(r, st.q) !== Infinity); return qs.get(r); };
  for (const r of recs) {
    if (!okQ(r)) continue;
    if (keep(r, st, 'level')) { level.set(r.level, (level.get(r.level) || 0) + 1); if (r.group) group.set(r.group, (group.get(r.group) || 0) + 1); }
    if (keep(r, st, 'subject')) { const e = subject.get(r.subject) || { id: r.subject, name: r.subjectName, count: 0 }; e.count++; subject.set(r.subject, e); }
    if (keep(r, st, 'year')) year.set(r.year, (year.get(r.year) || 0) + 1);
  }
  return {
    level,
    group,
    subjects: [...subject.values()].sort((a, b) => cmp(a.name, b.name)),
    years: [...year].map(([y, count]) => ({ year: y, count })).sort((a, b) => b.year - a.year),
  };
}

/** The subject list under the field: names that start with (or have a word that starts with) the text first, then names that contain it. */
export function filterSubjects(subjects, text) {
  const f = fold(text);
  if (!f) return subjects;
  const pre = [], sub = [];
  for (const s of subjects) {
    const n = fold(s.name);
    if (n.startsWith(f) || n.split(' ').some((w) => w.startsWith(f))) pre.push(s);
    else if (n.includes(f)) sub.push(s);
  }
  return [...pre, ...sub];
}

/** When nothing matches: which single relaxation brings results back (with its count), and the nearest years that have some. */
export function suggestions(recs, st) {
  const out = [];
  const count = (s) => search(recs, s).length;
  for (const key of ['year', 'subject', 'level', 'q']) {
    if (st[key] === '' || st[key] == null) continue;
    const n = count({ ...st, [key]: '' });
    if (n) out.push({ drop: key, count: n });
  }
  if (st.year) {
    const ys = facets(recs, st).years.map((y) => y.year).sort((a, b) => Math.abs(a - st.year) - Math.abs(b - st.year) || b - a).slice(0, 3);
    for (const y of ys) out.push({ set: 'year', value: String(y), count: count({ ...st, year: String(y) }) });
  }
  return out;
}

/** Build side: content/papers-manifest.json -> the compact index above. Newest year first, so a plain read of the file is already in list order. */
export function buildIndex(manifest, order = ['csee', 'acsee', 'psle', 'ftna'], whoOf = {}, groupOf = {}, groupNames = {}) {
  const exams = order.filter((id) => Object.keys(manifest).some((k) => k.startsWith(`${id}-`)));
  const names = [], nameIx = new Map();
  const rows = [];
  for (const [key, entry] of Object.entries(manifest)) {
    const [exam, y] = key.split('-');
    const L = exams.indexOf(exam);
    if (L < 0) continue;
    for (const [name, items] of entry.subjects) {
      if (!nameIx.has(name)) { nameIx.set(name, names.length); names.push(name); }
      for (const [chip, paper, pages, solution, solPages, original] of items) {
        if (!paper && !solution) continue;
        rows.push([L, Number(y), nameIx.get(name), chip, paper || '', pages || 0, solution || '', solPages || 0, original || '']);
      }
    }
  }
  rows.sort((a, b) => b[1] - a[1] || a[0] - b[0] || cmp(names[a[2]], names[b[2]]) || cmp(a[3], b[3]));
  const used = [...new Set(exams.map((id) => groupOf[id]).filter(Boolean))];
  return {
    v: 1,
    e: exams.map((id) => (groupOf[id] ? [id, id.toUpperCase(), whoOf[id] || '', groupOf[id]] : [id, id.toUpperCase(), whoOf[id] || ''])),
    ...(used.length ? { g: Object.fromEntries(used.map((g) => [g, groupNames[g] || g])) } : {}),
    s: names,
    r: rows,
  };
}

// Automatic comment screen for the Mayobe Bros comments API (English + Swahili).
//
//   screen(text) -> { flagged: boolean, reasons: string[] }
//
// A comment that passes is published at once. A comment that is flagged is NOT deleted: it is held as "pending"
// for a person to read, so a false alarm only costs a few seconds. Reasons are short codes for the moderator
// (never shown to the visitor).
//
// Design (see worker/README.md):
//  * Whole-word matching, never "contains", so "assess", "class" or "Scunthorpe" are not flagged.
//  * Text is normalised first: accents, zero-width characters, look-alike letters (Cyrillic/Greek), digits and symbols
//    used as letters (sh1t, f@ck, a$$), repeated letters (fuuuck) and spaced-out letters (f u c k, f.u.c.k).
//  * English endings (-s, -ed, -ing ...) and Swahili noun-class prefixes (m-, wa-, ki-, vi-, u- ...) are tolerated.
//  * Only Set lookups and short string searches: no giant regular expression, so there is no catastrophic
//    backtracking and the work stays far below the Workers Free CPU limit (about 10 ms) for a 1,500-letter comment.
//  * The word lists live in worker/wordlists/*.json; run `node worker/build-wordlist.mjs` after editing them.

import { WORDS, STEMS, PHRASES, SCAM } from './wordlist.js';

const WORD_SET = new Set(WORDS);

// Phrases are indexed by their first word: a phrase is only searched for where its first word occurs.
const PHRASE_INDEX = new Map();
for (const [kind, list] of [['phrase', PHRASES], ['scam', SCAM]]) {
  for (const p of list) {
    const first = p.split(' ', 1)[0];
    if (!PHRASE_INDEX.has(first)) PHRASE_INDEX.set(first, []);
    PHRASE_INDEX.get(first).push([kind, p]);
  }
}

// Look-alike letters from other alphabets that people use to dodge filters.
const CONFUSABLE = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', к: 'k', м: 'm', т: 't', н: 'h', в: 'b',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', ı: 'i',
};
const DIGIT_LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };
const SYMBOL_LEET = { '@': 'a', $: 's', '!': 'i', '+': 't', '|': 'i' };

// English endings (shortest stem 4 letters, or 3 for -s/-es) and Swahili prefixes (stem at least 4 letters).
const EN_SUFFIXES = ['ing', 'ers', 'ies', 'ed', 'er', 'es', 'in', 'y', 's'];
const SW_PREFIXES = ['mw', 'wa', 'ki', 'vi', 'ma', 'ku', 'ny', 'm', 'u', 'n'];

function squeeze(s) { return s.replace(/(.)\1+/g, '$1'); } // fuuuck -> fuck, pussy -> pusy
const undouble = (s) => (s.length > 3 && s[s.length - 1] === s[s.length - 2] ? s.slice(0, -1) : s);

/** Lowercase, remove accents and invisible characters, swap look-alike letters, drop apostrophes. */
function clean(text) {
  let t = String(text).normalize('NFKD').replace(/\p{M}+/gu, '').replace(/\p{Cf}+/gu, '').toLowerCase();
  t = t.replace(/[^\x00-\x7f]/g, (ch) => CONFUSABLE[ch] ?? ch);
  t = t.replace(/['’`´]/g, ''); // ng'ombe -> ngombe, don't -> dont
  t = t.replace(/(?<=[a-z0-9])[@$!+|](?=[a-z0-9])/g, (ch) => SYMBOL_LEET[ch]); // sh!t, f@ck, a$$ (inside a word only)
  return t;
}

/** Words in the text, each with its digit-for-letter variants. Pure numbers are left alone. */
function tokenise(text) {
  // a "|" marks the end of a sentence, clause or line, so a phrase is never matched across two sentences
  const marked = clean(text).replace(/[,.!?;:]+(?=\s|$)|\n+/g, ' | ');
  // stars count only inside a word (f*ck); at the edge they are Markdown bold or decoration
  const raw = marked.split(/[^a-z0-9*|]+/).map((t) => (t === '|' ? t : t.replace(/^\*+|\*+$/g, ''))).filter(Boolean);
  return raw.slice(0, 400).map((tok) => {
    if (!/[a-z]/.test(tok)) return { tok, forms: [tok] };
    const forms = new Set([tok]);
    if (/[013457]/.test(tok)) {
      forms.add(tok.replace(/[013457]/g, (d) => DIGIT_LEET[d]));
      if (tok.includes('1')) forms.add(tok.replace(/1/g, 'l').replace(/[03457]/g, (d) => DIGIT_LEET[d]));
    }
    return { tok, forms: [...forms] };
  });
}

/** Look one word form up: exact, then with an English ending or a Swahili prefix removed. */
function lookup(w) {
  if (w.length < 2 || w.length > 40) return null;
  if (WORD_SET.has(w)) return w;
  for (const suf of EN_SUFFIXES) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const base = w.slice(0, -suf.length);
      const longEnough = base.length >= 4 || suf === 's' || suf === 'es';
      if (!longEnough) continue;
      if (WORD_SET.has(base)) return base;
      if (WORD_SET.has(base + 'e')) return base + 'e'; // abus-ing -> abuse
      const und = undouble(base);
      if (und !== base && WORD_SET.has(und)) return und; // shitt-ing -> shit
      if (suf === 'ies' && WORD_SET.has(base + 'y')) return base + 'y';
    }
  }
  for (const pre of SW_PREFIXES) {
    if (w.length >= pre.length + 4 && w.startsWith(pre)) {
      const base = w.slice(pre.length);
      if (WORD_SET.has(base)) return base;
    }
  }
  return null;
}

/** A masked word such as f*ck or sh*t: same length, every letter equal except the stars. */
function maskedHit(w) {
  if (!w.includes('*') || w.length < 4 || w.length > 14 || !/^[a-z*]+$/.test(w) || w.replace(/\*/g, '').length < 2) return null;
  const re = new RegExp('^' + w.replace(/\*+/g, (s) => `[a-z]{${s.length}}`) + '$');
  for (const word of WORDS) if (word.length === w.length && re.test(word)) return word;
  return null;
}

// Stems are indexed by their first three letters, so a word is only compared with the few stems that could start inside it.
const STEM_INDEX = new Map();
for (const st of STEMS) {
  const k = st.slice(0, 3);
  if (!STEM_INDEX.has(k)) STEM_INDEX.set(k, []);
  STEM_INDEX.get(k).push(st);
}
function stemHit(s) {
  if (s.length < 6) return null;
  for (let i = 0; i + 6 <= s.length; i++) {
    const list = STEM_INDEX.get(s.substr(i, 3));
    if (list) for (const st of list) if (s.startsWith(st, i)) return st;
  }
  return null;
}

function wordHit(form) {
  let hit = lookup(form);
  if (hit) return hit;
  // a run of 3 or more of one letter is stretching (fuuuck): try it squeezed to single letters, matched against squeezed list words
  if (/(.)\1\1/.test(form)) {
    const one = squeeze(form);
    hit = lookup(one);
    if (hit) return hit;
    for (const w of SQUEEZED_LOOKUP(one)) return w;
  }
  return maskedHit(form) || stemHit(form);
}

// list words with doubled letters (pussy, bitch has none, kuma none): index them by their squeezed spelling, length 4 or more
const SQUEEZED = new Map();
for (const w of WORDS) {
  const s = squeeze(w);
  if (s !== w && s.length >= 4) SQUEEZED.set(s, w);
}
function* SQUEEZED_LOOKUP(s) { if (SQUEEZED.has(s)) yield SQUEEZED.get(s); }

/** Contact details are not allowed in comments (Comment Policy), so a comment that has them is held. */
function contactReason(text) {
  if (/[^\s@]{2,}@[^\s@]{2,}\.[a-z]{2,}/i.test(text)) return 'contact:email';
  const digits = text.replace(/[\s().\-]/g, '');
  if (/\+?\d{9,}/.test(digits)) return 'contact:phone';
  return null;
}

function shouting(text) {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 15) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.7;
}

/**
 * @param {string} text  everything a visitor typed (name and comment)
 * @returns {{flagged: boolean, reasons: string[]}}
 */
export function screen(text) {
  const reasons = [];
  const add = (r) => { if (!reasons.includes(r) && reasons.length < 8) reasons.push(r); };
  const src = String(text || '');

  const toks = tokenise(src);
  for (const { forms } of toks) {
    for (const f of forms) {
      const h = wordHit(f);
      if (h) { add('word:' + h); break; }
    }
  }

  // letters spaced out one by one (f u c k, f.u.c.k, f-u-c-k): join each run of 3 or more single letters
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      const joined = run.join('');
      const h = wordHit(joined);
      if (h) add('word:' + h);
    }
    run = [];
  };
  for (const { tok } of toks) {
    if (tok.length === 1 && /[a-z]/.test(tok)) run.push(tok);
    else flush();
  }
  flush();

  // phrases (insults, threats, scam lines) are matched on the word stream with letter stretching removed
  const stream = ' ' + toks.map(({ forms }) => squeezeKeep(forms[forms.length > 1 ? 1 : 0])).join(' ') + ' ';
  const plain = ' ' + toks.map(({ tok }) => squeezeKeep(tok)).join(' ') + ' ';
  const seen = new Set();
  for (const { tok, forms } of toks) {
    for (const w of [squeezeKeep(tok), squeezeKeep(forms[forms.length > 1 ? 1 : 0])]) {
      if (seen.has(w)) continue;
      seen.add(w);
      const cands = PHRASE_INDEX.get(w);
      if (!cands) continue;
      for (const [kind, p] of cands) if (stream.includes(' ' + p + ' ') || plain.includes(' ' + p + ' ')) add(kind + ':' + p);
    }
  }

  // letters of two alphabets inside one word (Latin + Cyrillic/Greek) are almost always a disguise
  if (/[a-z][\u0370-\u03ff\u0400-\u04ff]|[\u0370-\u03ff\u0400-\u04ff][a-z]/i.test(src)) add('mixed-script');

  const c = contactReason(src);
  if (c) add(c);
  if (shouting(src)) add('shouting');
  if (/(.)\1{11,}/.test(src)) add('flood');

  return { flagged: reasons.length > 0, reasons };
}

// phrases are stored with normal spelling; collapse only runs of 3+ so "see" and "all" survive
function squeezeKeep(s) { return s.replace(/(.)\1{2,}/g, '$1'); }

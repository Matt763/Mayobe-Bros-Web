/* Display names for NECTA schools, centres and colleges.
 *
 * NECTA prints names in UPPER CASE ("ST. STEPHEN BOYS SECONDARY SCHOOL", "MARY'S JUNIOR"). displayName() turns one into a clean
 * title-cased name for a page title or a heading ("St. Stephen Boys Secondary School", "Mary's Junior"). It is a pure function of
 * its argument: no state, no I/O, no dependencies, so it runs the same in Node, the browser and a Cloudflare Worker, and calling it
 * on its own output gives the same output (idempotent).
 *
 * What it never does: change, add, translate or drop a letter or a digit. It changes case and spacing, turns the odd apostrophe
 * marks (the typographic one, the backtick) into a plain ', removes junk at the two ends of a name ("** ", " :", " -", ". ."),
 * and drops zero-width characters; nothing else. Words are never "corrected" (SHOOL stays Shool): the page must show what NECTA
 * published. One exception, on purpose: a curly apostrophe that went through the wrong text encoding twice (1 name, "MARY" + three
 * stray characters + "S") is turned back into an apostrophe, the three stray characters are not letters worth keeping.
 *
 * Every rule was checked against the real names (about 40,000 distinct ones: the centre lists and the first line of every centre file
 * of all exam-years in results-data/, 2026-11-16; scripts/tests/results-names.test.mjs sweeps them all). The counts in the comments
 * below are numbers of distinct names that contain the word.
 *
 * How a name is cased:
 *  1. Clean-up (the names are all upper case first): odd marks, junk at the ends, spacing around ( ) & , and hyphens, and after the dot
 *     of an abbreviation ("ST.JAMES" gives "St. James", "SEC.SCHOOL" gives "Sec. School"; the dots of initials stay glued: "S.S",
 *     "J.W.T.Z."). A hyphen with a space on one side only loses it ("ENG- MED"), "AL - HIKIMA" becomes "Al-Hikima", " - " between
 *     two parts stays as it is.
 *  2. Each word (a run of letters and digits; an apostrophe inside a word does not split it) is decided by the first rule that fits:
 *     NAME_FIXES (the table below, acronyms and abbreviations), one letter or only digits (A, B, 17), Roman numerals (II, IX), a centre
 *     code (S4199, K3), a word of two to five letters with no vowel (JKT, FDC, TRC: nobody writes a name without vowels, so it is an
 *     acronym), a joiner in the middle of a name (of, and, the, ya, wa; "es" after "Dar"), and last of all an ordinary word: first
 *     letter upper case, the rest lower case.
 *  3. Inside a word an apostrophe does not start a new capital: Mary's, Girls', Ng'ombe. Only O' and D' do (O'Brien, D'Alzon).
 */

/** Words that keep their capitals. Only words that are NOT caught by the "no vowel" rule need to be here (JKT, FDC, TRC, TC, VTC,
 *  NHC... are consonants only and stay upper case by themselves). Each one below was found in the names; the number is how many
 *  distinct names contain it. Add a word here when a new one shows up. */
export const ACRONYMS = [
  'AICT', //   7  African Inland Church Tanzania
  'EAGT', //   1  Evangelical Assemblies of God Tanzania
  'ELCT', //   1  Evangelical Lutheran Church in Tanzania
  'EMPS', //   9  English Medium Primary School
  'SOS', //   12  SOS Children's Villages (SOS Hermann Gmeiner)
  'SUA', //    3  Sokoine University of Agriculture
  'VETA', //   3  Vocational Education and Training Authority
  'JICA', //   4  Japan International Cooperation Agency
  'SDA', //    2  Seventh-day Adventist
  'ACT', //    6  ACT Bunda Girls, ACT Mara (Anglican Church of Tanzania); not the English word here
  'ABC', //    3  ABC Capital, ABC Meru
  'JKU', //    4  same style as JKT
  'NAPS', //   4  an acronym in the names that were typed in mixed case ("NAPS Eng. Med. Primary School")
  'RHEC', //   9  likewise ("RHEC Eng. Med. Primary School")
  'ESACS', //  6  not a word
  'ACTAS', //  5  not a word
  'EDP', //    3  EDP Royal
  'OSP', //    5  OSP Ruhuji
  'SCIM', //   3  SCIM Polytechnic
  'AFAP', //   2  AFAP Primary School
  'KAC', //    3  KAC Secondary School
  'PEC', //    3  PEC Pre & Primary School
  'EG', //     2  EG White (Ellen G. White, Adventist), two initials written together
];

/** Abbreviations of ordinary words. They have no vowel, so the acronym rule would shout them (MWL, SCHL); they are cased like the
 *  word they stand for. */
export const ABBREVIATIONS = {
  ST: 'St', //     1,024  Saint (ST., ST)
  STS: 'Sts', //       1  Saints
  MT: 'Mt', //        41  Mount
  DR: 'Dr', //       124  Doctor
  DKT: 'Dkt', //      25  Daktari, Swahili for doctor
  MWL: 'Mwl', //      21  Mwalimu, Swahili for teacher
  FR: 'Fr', //         6  Father
  SR: 'Sr', //         4  Sister
  MR: 'Mr',
  MRS: 'Mrs',
  SCH: 'Sch', //      20  School
  SCHL: 'Schl', //    15  School
  GVT: 'Gvt', //       2  Government
  TR: 'Tr', //         2  Training (cut short in the source)
  PR: 'Pr', //         9  Primary (EBEN EZER ENG- MD PR SCHOOL)
  PRM: 'Prm', //       1  Primary
  MD: 'Md', //         7  Medium (ENG- MD PRIMARY SCHOOL)
  CNT: 'Cnt', //       2  Centre (KIWIRA COAL MINE SCHL CNT)
};

/** The one table the function reads: upper-case word (an apostrophe inside it stays) to the exact text to print. Extend it by
 *  adding keys (NAME_FIXES.XYZ = 'Xyz'); the lists above are only where the first entries come from. */
export const NAME_FIXES = Object.assign(Object.create(null), Object.fromEntries(ACRONYMS.map((a) => [a, a])), ABBREVIATIONS);

/** Little words that are written in lower case in the middle of a name, never as its first word. The numbers are distinct names with
 *  the word after the first one. English: of 137, and 879, the 30, for 1, to 2. Swahili "of" and "and": ya 134, wa 39, la 6, cha 22,
 *  na 6 (Shule ya Msingi, Chuo cha Ualimu, Gongo la Mboto, Simba wa Yuda, Alfa na Omega). French de (35: Charles de Foucauld,
 *  St. Francis de Sales) and Arabic bin (4: Jabir bin Zaid). "Es" is lower case only after "Dar" (48: Dar es Salaam, handled in
 *  caseWord). The names typed in mixed case ("Msitu Wa Tembo") capitalise the Swahili words; the all-capitals rest of the data gives no
 *  reason to, and Swahili spelling writes them small. Edit this set to change the rule. */
export const JOINERS = new Set(['OF', 'AND', 'THE', 'FOR', 'TO', 'YA', 'WA', 'LA', 'CHA', 'NA', 'DE', 'BIN']);

const ROMAN = new Set(['II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']);

// Marks that stand for an apostrophe: the typographic ones, the modifier letter, the acute accent and the backtick (15 names use it).
const APOSTROPHES = /[\u2018\u2019\u201B\u2032\u02BC\u00B4`]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E]/g;
// "â€™" is a curly apostrophe that went through the wrong text encoding twice (1 name).
const MOJIBAKE = /\u00E2\u20AC[\u2122\u02DC]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const CONTROL = /\p{Cc}/gu;

// Junk at the two ends of a name. Done with loops, not regexes: a regex like /[-]+$/ is quadratic on a very long run of hyphens.
const LEAD_JUNK = new Set([' ', '*', ':', ';', ',', '-', '_', '.']);
const TAIL_JUNK = new Set([' ', '*', ':', ';', ',', '-', '_']);
const LETTER = /\p{L}/u;
// (?<!\p{L}) starts a chain only at the start of a letter run: linear on a very long word
const DOT_CHAIN = /(?<!\p{L})\p{L}+(?:\.\p{L}+)+/gu;
const WORD = /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;

const ACRONYM_SHAPE = /^[BCDFGHJKLMNPQRSTVWXZ]{2,5}$/; // two to five letters, no vowel (Y counts as a vowel: SKY, GYM)
const CENTRE_CODE = /^[A-Z]{1,2}\d+$/; // S4199, K3, P0101: a code, not a word
const ORDINAL = /^\d+(?:ST|ND|RD|TH)$/;

// toLowerCase turns the Turkish dotted capital I (U+0130) into "i" plus a combining dot, which no longer upper-cases back to the
// same letter; such a letter stays a capital.
const lowerCase = (w) => w.toLowerCase().replace(/i\u0307/g, '\u0130');
const title = (w) => {
  const lower = lowerCase(w);
  const first = String.fromCodePoint(lower.codePointAt(0));
  return first.toUpperCase() + lower.slice(first.length);
};

/** Tidy an upper-case name: spacing and junk only. */
function tidy(s) {
  s = s.replace(/\s+/g, ' '); //                                         first, so no later pattern has to look through a long run of spaces
  s = s.replace(/'{2,}/g, "'"); //                                       GIRLS'' -> GIRLS'
  s = s.replace(/(\p{L})"(?=\p{L})/gu, "$1'"); //                         MANG"OLA -> MANG'OLA (a typing slip, 1 name)
  s = s.replace(/([\p{L}\p{N}])'(\p{L})'/gu, "$1 '$2'"); //               KIRURUMA'A' -> KIRURUMA 'A' (a quoted letter, 80 names)
  s = s.replace(/(^|[^\p{L}\p{N}])(['"])(\p{L})\2(?=[\p{L}\p{N}])/gu, '$1$2$3$2 '); //  'B'PRIMARY -> 'B' PRIMARY
  s = s.replace(/([\p{L}\p{N}])\(/gu, '$1 ('); //                         CATEGORY(Gov -> CATEGORY (Gov
  s = s.replace(/\)(?=[\p{L}\p{N}])/gu, ') ');
  s = s.replace(/\(\s+/g, '(').replace(/\s+([,;:)])/g, '$1');
  s = s.replace(/,(?=\p{L})/gu, ', ');
  s = s.replace(/\s*&\s*/g, ' & '); //                                   PRE&PRIMARY -> PRE & PRIMARY
  s = s.replace(DOT_CHAIN, (chain) => {
    // ST.JAMES -> ST. JAMES, REV.A.BUNGWA -> REV. A. BUNGWA, but J.W.T.Z and S.S stay whole (only single letters between the dots)
    const seg = chain.split('.');
    let out = seg[0];
    for (let i = 1; i < seg.length; i++) out += '.' + (seg[i - 1].length > 1 || seg[i].length > 1 ? ' ' : '') + seg[i];
    return out;
  });
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

const ARABIC_ARTICLES = new Set(['AL', 'EL', 'AN', 'AT', 'UL']);
const lonely = (t) => /^-+$/.test(t);
/** Spaces around hyphens. "ENG- MED" and "ENG -MD" are hyphenated words and lose the stray space; "AL - HIKIMA" is an Arabic article and
 *  loses both (20 names); a hyphen with a space on both sides is a dash between two parts ("NYERERE HIGH SCHOOL - MIGOLI") and stays.
 *  Every join is decided from the words as they came, so the result does not change when the function runs on its own output. */
function joinHyphens(s) {
  if (s.indexOf('-') < 0) return s;
  const t = s.split(' ');
  let out = t[0];
  for (let k = 1; k < t.length; k++) {
    const a = t[k - 1];
    const b = t[k];
    const glue = (ARABIC_ARTICLES.has(a) && lonely(b) && k + 1 < t.length && !lonely(t[k + 1]))
      || (k >= 2 && ARABIC_ARTICLES.has(t[k - 2]) && lonely(a) && !lonely(b))
      || (!lonely(a) && !lonely(b) && (a.endsWith('-') || b.startsWith('-')));
    out += (glue ? '' : ' ') + b;
  }
  return out;
}

/** Remove junk from both ends, until nothing more comes off. A dot after a word of five or more letters goes ("SECONDARY.",
 *  "SCHOOL.."); a dot after a short word stays, it is an abbreviation or an initial ("SEC.", "S.S."); lone dots go. */
function trimEnds(s) {
  for (;;) {
    let a = 0;
    let b = s.length;
    while (a < b && LEAD_JUNK.has(s[a])) a++;
    while (b > a && TAIL_JUNK.has(s[b - 1])) b--;
    let e = b;
    while (e > a && s[e - 1] === '.') e--;
    const dots = b - e;
    if (dots > 0) {
      if (e === a || s[e - 1] === ' ') b = e; //                            ". ." after a word, or nothing but dots
      else {
        let k = e;
        while (k > a && LETTER.test(s[k - 1])) k--;
        if (e - k >= 5) b = e;
        else if (dots > 1) b = e + 1;
      }
    }
    if (a === 0 && b === s.length) return s;
    s = s.slice(a, b);
  }
}

/** The text for one word. `key` is upper case, apostrophes inside kept; `wi` is the word's place in the name; `prev` the word before. */
function caseWord(key, wi, prev) {
  const fix = NAME_FIXES[key];
  if (fix !== undefined) return fix;
  const parts = key.split("'");
  if (parts.length === 1) {
    if (key.length === 1 || /^\d+$/.test(key)) return key; //            A, B, 17
    if (ROMAN.has(key)) return key; //                                    II, IX
    if (CENTRE_CODE.test(key)) return key; //                             S4199, K3
    if (ACRONYM_SHAPE.test(key)) return key; //                           JKT, FDC, TRC, NHC
    if (ORDINAL.test(key)) return key.toLowerCase(); //                   1st, 2nd
    if (/^\d/.test(key)) return key; //                                   3D
    if (wi > 0 && (JOINERS.has(key) || (key === 'ES' && prev === 'DAR'))) return key.toLowerCase();
    return title(key);
  }
  // Mary's, Girls', Ng'ombe: no capital after the apostrophe, except O'Brien and D'Alzon.
  const keepNext = parts[0] === 'O' || parts[0] === 'D';
  return parts.map((p, i) => (i === 0 ? title(p) : i === 1 && keepNext ? title(p) : lowerCase(p))).join("'");
}

/**
 * A clean display name for a NECTA school, centre or college name.
 * @param {unknown} raw  the name as NECTA published it (null and undefined give '')
 * @returns {string}     title-cased name; letters and digits exactly as given (see the header of this file), spaces tidied
 */
export function displayName(raw) {
  if (raw === null || raw === undefined) return '';
  const text = String(raw);
  if (!text) return '';
  let s = text.replace(MOJIBAKE, "'").replace(INVISIBLE, '').replace(CONTROL, ' ').replace(APOSTROPHES, "'").replace(DOUBLE_QUOTES, '"');
  s = s.toUpperCase();
  const plain = s.replace(/\s+/g, ' ').trim();
  s = joinHyphens(trimEnds(tidy(s)));
  if (!s) return plain; // nothing but punctuation: show it as it came, never an empty title
  let wi = 0;
  let prev = '';
  return s.replace(WORD, (key) => {
    const out = caseWord(key, wi, prev);
    wi++;
    prev = key;
    return out;
  });
}

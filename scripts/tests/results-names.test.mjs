// displayName() in results-worker/src/names.js: NECTA's UPPER CASE school names to clean title case.
//  1. The rules, one test each, with real names from results-data/ (every example below is a name NECTA published, typos included).
//  2. A sweep of every distinct name in results-data/ (the centre lists plus the first line of every centre file, about 40,000 names):
//     never throws, never empty, no double spaces, no letter or digit changed or lost, idempotent, fast, and the 40 most suspicious
//     outputs are printed in the test log so a person can look at them.
// The data folder is git-ignored: without it the examples are still checked, the sweep is skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayName, NAME_FIXES, JOINERS, ACRONYMS, ABBREVIATIONS } from '../../results-worker/src/names.js';
import { decodeList } from '../../js/results-codec.js';
import { headerName } from '../../results-worker/src/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'results-data');
const haveData = fs.existsSync(path.join(DATA, 'registry.json'));

// [name as NECTA published it, expected display name]
const RULES = {
  'Saint, Mount, Doctor and the other titles keep their dot and take a small letter': [
    ['ST. MATTHEW (K3-2003) SEC. SCHOOL', 'St. Matthew (K3-2003) Sec. School'],
    ['ST FRANCIS PRE & PRIMARY SCHOOL', 'St Francis Pre & Primary School'],
    ['ST.JAMES PRIMARY SCHOOL', 'St. James Primary School'],
    ['STS. RUFINO & RINALDO', 'Sts. Rufino & Rinaldo'],
    ['DR. JOHN POMBE MAGUFULI (U) SECONDARY SCHOOL', 'Dr. John Pombe Magufuli (U) Secondary School'],
    ['DR.OMARI PRIMARY SCHOOL', 'Dr. Omari Primary School'],
    ['DKT. ALI MOHAMED SHEIN', 'Dkt. Ali Mohamed Shein'],
    ['MWL. TUTUBA', 'Mwl. Tutuba'],
    ['MWL JULIUS KAMBARAGE NYERERE P/S', 'Mwl Julius Kambarage Nyerere P/S'],
    ['MT.CARMEL SECONDARY SCHOOL', 'Mt. Carmel Secondary School'],
    ['FR.SILVIO PASQUALI PRIMARY SCHOOL', 'Fr. Silvio Pasquali Primary School'],
    ['SR.PAULIN BOMMER PRIMARY SCHOOL', 'Sr. Paulin Bommer Primary School'],
    ['Dr.Wilbroad Slaa S.S', 'Dr. Wilbroad Slaa S.S'],
  ],
  'Apostrophes: no capital after them, and the odd marks become a plain apostrophe': [
    ["MARY'S CAMP PRIMARY SCHOOL", "Mary's Camp Primary School"],
    ["BETHEL SABS GIRLS' SEC. SCHOOL, MAFINGA", "Bethel Sabs Girls' Sec. School, Mafinga"],
    ['PERAMIHO GIRL`S SECONDARY SCHOOL', "Peramiho Girl's Secondary School"],
    ['ANNE MAKINDA GIRLS` SECONDARY.', "Anne Makinda Girls' Secondary"],
    ['BOMALANG\u2019OMBE S.S', "Bomalang'ombe S.S"],
    ['ST. MARY\u2019S ULETE', "St. Mary's Ulete"],
    ['ST. MARY\u00E2\u20AC\u2122S MBEZI BEACH PRIMARY SCHOOL', "St. Mary's Mbezi Beach Primary School"],
    ['NG`AWA PRIMARY SCHOOL', "Ng'awa Primary School"],
    ['MAKONG`ONDERA PRIMARY SCHOOL', "Makong'ondera Primary School"],
    ["King'ori S.S", "King'ori S.S"],
    ['Mang"ola S.S', "Mang'ola S.S"],
    ["SUN (SISTER''S OF USHIRIKA WA NEEMA) SECONDARY S", "Sun (Sister's of Ushirika wa Neema) Secondary S"],
  ],
  "O' and D' are French and Irish names: the letter after them is a capital": [
    ['O`BRIEN PRIMARY SCHOOL', "O'Brien Primary School"],
    ["D'ALZON GIRLS' SECONDARY SCHOOL", "D'Alzon Girls' Secondary School"],
    ["D'Alzon S.s", "D'Alzon S.S"],
  ],
  'Hyphens, slashes, ampersands: each part is a word; a space on one side only is not kept': [
    ['AL-HARAMAIN', 'Al-Haramain'],
    ['AL - HIKIMA BOYS SECONDARY SCHOOL', 'Al-Hikima Boys Secondary School'],
    ['EL- SHADDAI PRIMARY SCHOOL', 'El-Shaddai Primary School'],
    ['KAMATA-NAMBA-3 PRIMARY SCHOOL', 'Kamata-Namba-3 Primary School'],
    ['CHUO CHA UFUNDI - VETA CENTRE', 'Chuo cha Ufundi - VETA Centre'],
    ['NYERERE HIGH SCHOOL - MIGOLI', 'Nyerere High School - Migoli'],
    ['EBEN EZER ENG- MD PR SCHOOL', 'Eben Ezer Eng-Md Pr School'],
    ['AVICENNA ENG -MD PRIMARY SCHOOL', 'Avicenna Eng-Md Primary School'],
    ['KAINAM/RHOTIA PRIMARY SCHOOL', 'Kainam/Rhotia Primary School'],
    ['KITETE W/S PRIMARY SCHOOL', 'Kitete W/S Primary School'],
    ['ST. FRANCIS P / SCHOOL', 'St. Francis P / School'],
    ['JOSEPH&MARY', 'Joseph & Mary'],
    ['GOLDEN CHANCE PRE&PRIMARY SCHOOL', 'Golden Chance Pre & Primary School'],
    ['POLY PRE_PRIMARY SCHOOL. .', 'Poly Pre_Primary School'],
  ],
  'Parentheses stay, with a space outside them': [
    ['NYERERE (MWANGA) SECONDARY SCHOOL', 'Nyerere (Mwanga) Secondary School'],
    ['PAMBA (I A E) SECONDARY SCHOOL CENTRE', 'Pamba (I A E) Secondary School Centre'],
    ['NEWVIBE(ENGLISHMEDIUM)PRIMARY', 'Newvibe (Englishmedium) Primary'],
    ['NDAMHI (New school)', 'Ndamhi (New School)'],
    ['KING DAVID (2019) PRIMARY SCHOOL', 'King David (2019) Primary School'],
    ['MCHANGANYIKO SECONDARY CATEGORY(Government Non-Gov', 'Mchanganyiko Secondary Category (Government Non-Gov'],
  ],
  'Roman numerals stay upper case': [
    ['ST. PIO IX PRIMARY SCHOOL', 'St. Pio IX Primary School'],
    ['ST PIO X MALINYI', 'St Pio X Malinyi'],
    ['BUYUNI-II PRIMARY SCHOOL', 'Buyuni-II Primary School'],
    ['DARAJA- II PRIMARY SCHOOL', 'Daraja-II Primary School'],
    ['MUTEESA 1 JUNIOR PRIMARY SCHOOL', 'Muteesa 1 Junior Primary School'],
  ],
  'Acronyms: words with no vowel, and the ones in ACRONYMS': [
    ['UBUNGO NHC PRIMARY SCHOOL', 'Ubungo NHC Primary School'],
    ['CHITA-JKT PRIMARY SCHOOL', 'Chita-JKT Primary School'],
    ['MASASI FDC', 'Masasi FDC'],
    ['FPCT SHINYANGA VIJANA CENTRE', 'FPCT Shinyanga Vijana Centre'],
    ['TUNDUMA TC CENTRE', 'Tunduma TC Centre'],
    ['MWANGA TRC CENTRE', 'Mwanga TRC Centre'],
    ['KAHAMA SDA PRIMARY SCHOOL', 'Kahama SDA Primary School'],
    ['KIBETA ELCT PRIMARY SCHOOL', 'Kibeta ELCT Primary School'],
    ['TABATA JICA PRIMARY SCHOOL', 'Tabata JICA Primary School'],
    ['SOS HERMANN GMEINER SCHOOL', 'SOS Hermann Gmeiner School'],
    ['AICT ILUNGU PRIMARY SCHOOL', 'AICT Ilungu Primary School'],
    ['VETA PRIMARY SCHOOL', 'VETA Primary School'],
    ['SUA SECONDARY SCHOOL', 'SUA Secondary School'],
    ['NAPS ENGLISH MEDIUM PRIMARY SCHOOL', 'NAPS English Medium Primary School'],
    ['MUNGU BARIKI EMPS PRIMARY SCHOOL', 'Mungu Bariki EMPS Primary School'],
    ['IYULA MALAIKA SS CENTRE', 'Iyula Malaika SS Centre'],
    ['IBINDO PS PRIMARY SCHOOL', 'Ibindo PS Primary School'],
    ['EG WHITE SECONDARY SCHOOL', 'EG White Secondary School'],
  ],
  'Initials with dots keep their dots and capitals; abbreviations get a space after the dot': [
    ['NYUKI J.W.T.Z. CEN', 'Nyuki J.W.T.Z. Cen'],
    ['MGULANI J.K.T. CEN', 'Mgulani J.K.T. Cen'],
    ['Kiranyi S.S.', 'Kiranyi S.S.'],
    ['Hayderer s.s.', 'Hayderer S.S.'],
    ['REV.A.BUNGWA SEC.SCHOOL (S4199)', 'Rev. A. Bungwa Sec. School (S4199)'],
    ['DR.A.M.SHEIN SECONDARY SCHOOL', 'Dr. A.M. Shein Secondary School'],
    ['ZANZIBAR PROGRESSIVE SEC.SCH.CENTRE', 'Zanzibar Progressive Sec. Sch. Centre'],
    ['ENGLISH SPEAKING INT.MUSL.S.S CENTRE', 'English Speaking Int. Musl. S.S Centre'],
    ['MASJID QUBAH (K3-2003) MUSL.SEMINARY', 'Masjid Qubah (K3-2003) Musl. Seminary'],
    ['F.T. Sumaye S.S', 'F.T. Sumaye S.S'],
  ],
  'Abbreviations of ordinary words are written like the word': [
    ['KIWIRA COAL MINE SCHL CNT', 'Kiwira Coal Mine Schl Cnt'],
    ['TEMBONI GVT. SECONDARY SCHOOL', 'Temboni Gvt. Secondary School'],
    ['MWANANYAMALA-KISIWANI PRM. SCHOOL', 'Mwananyamala-Kisiwani Prm. School'],
    ['ALI HASSAN MWINYI ISLAMIC PR SCHOOL', 'Ali Hassan Mwinyi Islamic Pr School'],
    ['ALI HASSAN MWINYI ISL.', 'Ali Hassan Mwinyi Isl.'],
    ['KOM S.S.', 'Kom S.S.'],
    ['USA RIVER SEMINARY', 'Usa River Seminary'],
  ],
  'Little words are small in the middle of a name, never first': [
    ['QUEEN OF APOSTLES-', 'Queen of Apostles'],
    ['HOLY GHOST SECONDARY SCHOOL FOR THE DEAF', 'Holy Ghost Secondary School for the Deaf'],
    ['CHRIST THE KING PRE & PRIMARY SCHOOL', 'Christ the King Pre & Primary School'],
    ['GLORY TO GOD PRIMARY SCHOOL', 'Glory to God Primary School'],
    ['MUTEESA 1 JUNIOR PRE AND PRIMARY SCHOOL', 'Muteesa 1 Junior Pre and Primary School'],
    ['SHULE YA MSINGI BIGWA', 'Shule ya Msingi Bigwa'],
    ['GONGO LA MBOTO JICA PRIMARY SCHOOL', 'Gongo la Mboto JICA Primary School'],
    ['LA MIRIAM SECONDARY SCHOOL', 'La Miriam Secondary School'],
    ['CHUO CHA UALIMU ST. BERNARD', 'Chuo cha Ualimu St. Bernard'],
    ['SIMBA WA YUDA CENTRE', 'Simba wa Yuda Centre'],
    ['Msitu Wa Tembo S.S', 'Msitu wa Tembo S.S'],
    ['ALFA NA OMEGA SECONDARY SCHOOL', 'Alfa na Omega Secondary School'],
    ['ST. FRANCIS DE SALES SEMINARY', 'St. Francis de Sales Seminary'],
    ['JABIR BIN ZAID PRIMARY SCHOOL', 'Jabir bin Zaid Primary School'],
    ['NATIONAL INSTITUTE OF TRANSPORT', 'National Institute of Transport'],
    ['DAR ES SALAAM GIRLS\'', "Dar es Salaam Girls'"],
    ['DAR-ES-SALAAM CHRISTIAN SEMINARY', 'Dar-es-Salaam Christian Seminary'],
    ['DAR ES-SALAAM PRIME SEC SCHL CENTRE', 'Dar es-Salaam Prime Sec Schl Centre'],
    ['TOTERA PRE-AND PRIMARY SCHOOL', 'Totera Pre-and Primary School'],
  ],
  'Digits: codes stay upper case, words that carry a number are still words': [
    ['FARM 17 PRIMARY SCHOOL', 'Farm 17 Primary School'],
    ['MAKUKWE1 PRIMARY SCHOOL', 'Makukwe1 Primary School'],
    ['KANEGELE2023 SECONDARY SCHOOL', 'Kanegele2023 Secondary School'],
    ['KARAMBI SEC SCHOOL REG: S1435', 'Karambi Sec School Reg: S1435'],
    ['HWAZI SECONDARY SCHOOL CENTRE NUMBER: S.3248', 'Hwazi Secondary School Centre Number: S.3248'],
    ['SIRARI S.S. CENTRE NO. S.4280', 'Sirari S.S. Centre No. S.4280'],
    ['OLJORO-NO.5 PRIMARY SCHOOL', 'Oljoro-No.5 Primary School'],
    ['SEGESE NO. 1 PRIMARY SCHOOL', 'Segese No. 1 Primary School'],
    ['14 KAMBARAGE PRIMARY SCHOOL', '14 Kambarage Primary School'],
    ['MAGNUS SEC0NDARY SCHOOL CENTRE', 'Magnus Sec0ndary School Centre'],
  ],
  'Quoted letters (Bunju "A", Rusumo \'B\') stay capital letters': [
    ['BUNJU "A" SECONDARY SCHOOL', 'Bunju "A" Secondary School'],
    ['MICHIGA `B` PRIMARY SCHOOL', "Michiga 'B' Primary School"],
    ["KIRURUMA'A' PRIMARY SCHOOL", "Kiruruma 'A' Primary School"],
    ["KIRURUMA 'B' PRIMARY SCHOOL", "Kiruruma 'B' Primary School"],
    ["BUNDA'B'PRIMARY SCHOOL", "Bunda 'B' Primary School"],
    ["BUNDA 'B'PRIMARY SCHOOL", "Bunda 'B' Primary School"],
    ["BUNJU-'A' PRIMARY SCHOOL", "Bunju-'A' Primary School"],
  ],
  'Junk at the ends of a name is removed, nothing else': [
    ['** NEW SCHOOL', 'New School'],
    ['**NKOLOLO', 'Nkololo'],
    ['-AL-HIKMA BOYS SECONDARY SCHOOL', 'Al-Hikma Boys Secondary School'],
    ['TIRAV SECONDARY SCHOOL :', 'Tirav Secondary School'],
    ['LUKUMBULE SECONDARY SCHOOL:', 'Lukumbule Secondary School'],
    ['MAKANDA:', 'Makanda'],
    ['ST.JAMES SEMINARY,', 'St. James Seminary'],
    ['CHUO CHA UFUNDI -', 'Chuo cha Ufundi'],
    ['IKUWO SEC. SCHOOL..', 'Ikuwo Sec. School'],
    ['RUNAZI SECONDARY SCHOOL S.3015.', 'Runazi Secondary School S.3015.'],
  ],
  'Names typed in mixed case are cased the same way': [
    ['Maji ya chai', 'Maji ya Chai'],
    ['Kimnyaki sec', 'Kimnyaki Sec'],
    ['Imboru S.S', 'Imboru S.S'],
    ['RoNeCa', 'Roneca'],
    ['NAPS Eng. Med. Primary School', 'NAPS Eng. Med. Primary School'],
    ['St. THERESA OF CALCUTA PRIMARY SCHOOL', 'St. Theresa of Calcuta Primary School'],
    ['NUR ISLAMIC SEMINARY CATEGORY (Government Non-Gove', 'Nur Islamic Seminary Category (Government Non-Gove'],
  ],
  'Plain names': [
    ['KIBAHA PRIMARY SCHOOL', 'Kibaha Primary School'],
    ['MWENGE SECONDARY SCHOOL CENTRE', 'Mwenge Secondary School Centre'],
    ['GALLAPO FOUNDATION PRE AND PRIMARY ENGLISH ME PRIMARY SCHOOL', 'Gallapo Foundation Pre and Primary English Me Primary School'],
    ["MPWAPWA TEACHERS' COLLEGE CENTRE", "Mpwapwa Teachers' College Centre"],
    ['LUGALO J.W.T.Z. CE', 'Lugalo J.W.T.Z. Ce'],
    ['EL-SHAMMAH', 'El-Shammah'],
  ],
};

const NAMES = [];
for (const [rule, examples] of Object.entries(RULES)) for (const [input, expected] of examples) NAMES.push({ rule, input, expected });

// ---- the corpus: the lists of every exam-year plus the name on the first line of every centre file ----
function firstLine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    let size = 8192;
    for (;;) {
      const buf = Buffer.alloc(size);
      const n = fs.readSync(fd, buf, 0, size, 0);
      const text = buf.toString('utf8', 0, n);
      const nl = text.indexOf('\n');
      if (nl >= 0 || n < size) return nl >= 0 ? text.slice(0, nl + 1) : text + '\n';
      size *= 8;
    }
  } finally { fs.closeSync(fd); }
}

let corpusMemo = null;
function corpus() {
  if (corpusMemo) return corpusMemo;
  const started = Date.now();
  const quick = !!process.env.NAMES_QUICK; // only the centre lists (a few seconds faster; the old lists cut long names short)
  const names = new Set();
  let exams = 0;
  for (const dir of fs.readdirSync(DATA)) {
    const meta = path.join(DATA, dir, 'meta.json');
    if (!fs.existsSync(meta) || !fs.existsSync(path.join(DATA, dir, 'list.json'))) continue;
    exams++;
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    for (const row of decodeList(JSON.parse(fs.readFileSync(path.join(DATA, dir, 'list.json'), 'utf8')), m.kind)) {
      names.add(row[1]);
      if (quick || !row[2]) continue;
      const file = path.join(DATA, dir, row[0].toLowerCase() + '.txt');
      if (fs.existsSync(file)) names.add(headerName(firstLine(file), m));
    }
  }
  corpusMemo = { names: [...names], exams, loadMs: Date.now() - started, quick };
  return corpusMemo;
}

for (const [rule, examples] of Object.entries(RULES)) {
  test(`rule: ${rule}`, () => {
    for (const [input, expected] of examples) assert.equal(displayName(input), expected, `${JSON.stringify(input)}`);
  });
}

test('the examples are real names (every one is in the data when the data is here)', { skip: !haveData ? 'results-data/ is not on this computer' : process.env.NAMES_QUICK ? 'NAMES_QUICK reads only the centre lists, which cut long names short' : false }, (t) => {
  const have = new Set(corpus().names);
  const missing = NAMES.filter((x) => !have.has(x.input)).map((x) => x.input);
  t.diagnostic(`${NAMES.length} examples, ${NAMES.length - missing.length} found in ${have.size} distinct names`);
  assert.deepEqual(missing, [], 'these examples are not real names (fix the example, or the data changed)');
});

test('the idle cases: nothing, nothing but punctuation, other alphabets, very long names', () => {
  assert.equal(displayName('ST. STEPHEN BOYS SECONDARY SCHOOL'), 'St. Stephen Boys Secondary School');
  assert.equal(displayName("MARY'S JUNIOR"), "Mary's Junior");
  assert.equal(displayName(''), '');
  assert.equal(displayName(null), '');
  assert.equal(displayName(undefined), '');
  assert.equal(displayName('   \t '), '');
  assert.equal(displayName('***'), '***', 'punctuation only: shown as it came, never empty');
  assert.equal(displayName('...'), '...');
  assert.equal(displayName(12345), '12345');
  assert.equal(displayName('0714'), '0714');
  assert.equal(displayName('S0101'), 'S0101');
  assert.equal(displayName('PS0101001'), 'PS0101001');
  // non-ASCII letters (E acute) are cased like any other
  assert.equal(displayName('\u00C9COLE SAINT-JOS\u00C9'), '\u00C9cole Saint-Jos\u00E9');
  assert.equal(displayName('\u03A3\u039F\u03A6\u039F\u03A3'), '\u03A3\u03BF\u03C6\u03BF\u03C2');
  assert.equal(displayName('  KIBAHA \n  PRIMARY\u00A0SCHOOL  '), 'Kibaha Primary School');
  assert.equal(displayName('A\u200BB'), 'Ab', 'zero-width characters are dropped');
  const long = 'KIBAHA '.repeat(5000).trim();
  assert.equal(displayName(long), 'Kibaha '.repeat(5000).trim());
  assert.equal(displayName('1ST AVENUE'), '1st Avenue');
  assert.equal(displayName('3D SCHOOL'), '3D School');
  assert.equal(displayName('XX XIV'), 'XX XIV');
});

test('a long run of one character cannot make it slow (no quadratic pattern)', () => {
  const started = Date.now();
  const inputs = ['A'.repeat(200000), 'A' + ' '.repeat(200000) + 'B', 'A' + '-'.repeat(200000) + 'B', 'A' + '.'.repeat(200000) + 'B',
    '.'.repeat(200000), 'A.B'.repeat(50000), "A'".repeat(100000), '('.repeat(100000), '& '.repeat(100000), 'A '.repeat(100000) + '.'.repeat(1000)];
  for (const x of inputs) {
    const out = displayName(x);
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0);
    assert.equal(displayName(out), out, 'idempotent on ' + x.slice(0, 12));
  }
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms for ten 200,000-character inputs`);
});

test('hostile input: 100,000 random strings never throw, never lose a letter, and settle after one pass', () => {
  const atoms = ['A', 'B', 'S', 'ST', 'DR', 'MT', 'JKT', 'SCHOOL', 'Secondary', 'of', 'and', 'YA', 'de', 'es', 'DAR', 'II', 'IX', 'x', '1', '2', 'K3',
    'S4199', '.', ' ', '  ', '-', ' - ', '--', '/', '&', '(', ')', '"', "'", "''", '`', '’', '*', ':', ',', ';', '_', '…', 'é', 'ß',
    'İ', 'Σ', '́', ' ', '\t', '\n', 'ab', 'Ng', 'MARY', 'S.S', 'J.W.T.Z.', 'A.B', 'O', 'D', 'AL', 'EL', '​', 'â€™',
    'ENG', 'MD', '😀', '𝒜'];
  let seed = 20261116; // a fixed generator: the same strings on every run
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const keep = (x) => x.replace(MOJIBAKE, "'").toUpperCase().replace(/[​-‍⁠﻿]/g, '').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  for (let i = 0; i < 100000; i++) {
    let input = '';
    for (let j = 1 + Math.floor(next() * 9); j > 0; j--) input += atoms[Math.floor(next() * atoms.length)];
    const out = displayName(input);
    assert.equal(typeof out, 'string');
    assert.equal(displayName(out), out, `not idempotent: ${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    assert.equal(keep(out), keep(input), `letters changed: ${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    if (keep(input).length > 0 || input.replace(/\s/g, '').length > 0) assert.ok(out.length > 0 || !input.replace(/[\s​-‍⁠﻿]/g, ''), `empty: ${JSON.stringify(input)}`);
  }
});

test('a word in NAME_FIXES and in JOINERS can be added without touching the code', () => {
  assert.equal(displayName('KILI SCHOOL KWA WATOTO'), 'Kili School Kwa Watoto');
  NAME_FIXES.KILI = 'KILI';
  JOINERS.add('KWA');
  try { assert.equal(displayName('KILI SCHOOL KWA WATOTO'), 'KILI School kwa Watoto'); }
  finally { delete NAME_FIXES.KILI; JOINERS.delete('KWA'); }
  assert.equal(displayName('KILI SCHOOL KWA WATOTO'), 'Kili School Kwa Watoto');
});

test('the tables agree: every fix is spelled like its key, nothing is listed twice', () => {
  for (const [key, value] of Object.entries(NAME_FIXES)) {
    assert.equal(key, key.toUpperCase(), key);
    assert.equal(value.toUpperCase(), key, `${key} -> ${value} would change a letter`);
  }
  assert.equal(new Set(ACRONYMS).size, ACRONYMS.length, 'a word is listed twice in ACRONYMS');
  for (const a of ACRONYMS) {
    assert.ok(!(a in ABBREVIATIONS), a);
    assert.ok(!/^[BCDFGHJKLMNPQRSTVWXZ]{2,5}$/.test(a), `${a} has no vowel: the shape rule already keeps it upper case`);
  }
  for (const j of JOINERS) assert.equal(j, j.toUpperCase());
});

// ---- the sweep ----
const lettersOf = (s) => s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
const MOJIBAKE = /\u00E2\u20AC[\u2122\u02DC]/g;
/** What must survive: the text without spaces and junk ends, odd apostrophes plain. Only the cleaning rules of names.js may differ. */
const skeleton = (s) => s.replace(MOJIBAKE, "'").toUpperCase().replace(/[\u2018\u2019\u201B\u2032\u02BC\u00B4`]/g, "'")
  .replace(/(\p{L})"(?=\p{L})/gu, "$1'").replace(/'+/g, "'").replace(/\s+/g, '').replace(/^[*:;,\-_.]+|[*:;,\-_.]+$/g, '');

/** How odd an output looks, to point a person at the ones worth reading. Each reason has a weight and a kind. */
function suspicion(out) {
  const found = [];
  const add = (weight, kind, what) => found.push({ weight, kind, what });
  for (const w of out.split(/[\s\-/()&,:;'"._]+/)) {
    const letters = w.replace(/[^\p{L}]/gu, '');
    if (/\p{L}\d|\d\p{L}/u.test(w) && !/^[A-Z]{1,2}\d+$/.test(w)) add(3, 'letters and digits in one word', w);
    else if (letters.length >= 4 && letters.length <= 6 && /^\p{Lu}\p{Ll}*$/u.test(letters) && /[^AEIOUYaeiouy]{4}/.test(letters) && !(w.toUpperCase() in NAME_FIXES)) add(3, 'short word with four consonants in a row', w);
    else if (letters.length >= 2 && letters === letters.toUpperCase() && !(w.toUpperCase() in NAME_FIXES) && !/^[BCDFGHJKLMNPQRSTVWXZ]+$/.test(letters)
      && !/^(II|III|IV|VI|VII|VIII|IX|XI|XII)$/.test(letters)) add(2, 'capitals, not a known acronym', w);
  }
  if (/[*:;_"\u20AC\u2122@#]/.test(out)) add(3, 'odd character', out.match(/[*:;_"\u20AC\u2122@#]/)[0]);
  if ((out.match(/\(/g) || []).length !== (out.match(/\)/g) || []).length) add(2, 'open bracket', '(');
  if (/\b(REG|NUMBER|CATEGORY|DISTRICT|CENTER NO|CENTRE NO)\b/i.test(out) && /:|\(|\bno\./i.test(out)) add(2, 'something else typed after the name', 'category, number or district');
  if (out.length >= 58) add(1, 'as long as the source allows', 'probably cut short');
  if (!/\p{Ll}/u.test(out) && /\p{L}{4}/u.test(out)) add(2, 'no small letter at all', out);
  const top = found.reduce((m, f) => (f.weight > (m ? m.weight : 0) ? f : m), null);
  return { n: found.reduce((t, f) => t + f.weight, 0), kind: top ? top.kind : '', why: found.map((f) => `${f.what} (${f.kind})`).join('; ') };
}

test('sweep: every distinct name in results-data/', { skip: haveData ? false : 'results-data/ is not on this computer' }, (t) => {
  const { names, exams, loadMs, quick } = corpus();
  assert.ok(names.length > 1000, `expected the corpus, got ${names.length} names`);

  const outs = new Array(names.length);
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < names.length; i++) outs[i] = displayName(names[i]);
  const ms = Number(process.hrtime.bigint() - t1) / 1e6;

  const problems = [];
  const bad = (kind, i, extra = '') => { if (problems.length < 25) problems.push(`${kind}: ${JSON.stringify(names[i])} -> ${JSON.stringify(outs[i])} ${extra}`); };
  let caseAndSpaceOnly = 0;
  const scored = [];
  for (let i = 0; i < names.length; i++) {
    const inp = names[i];
    const out = outs[i];
    if (typeof out !== 'string' || out.length === 0) { bad('empty', i); continue; }
    if (/[^\S ]| {2}|^ | $/.test(out)) bad('whitespace (only single plain spaces inside, none at the ends)', i);
    if (lettersOf(out) !== lettersOf(inp.replace(MOJIBAKE, "'"))) bad('letters changed or lost', i);
    if (skeleton(out) !== skeleton(inp)) bad('skeleton differs', i);
    if (out.toUpperCase() === inp.replace(/\s+/g, ' ').trim().toUpperCase()) caseAndSpaceOnly++;
    if (displayName(out) !== out) bad('not idempotent', i, `-> ${JSON.stringify(displayName(out))}`);
    scored.push({ inp, out, ...suspicion(out) });
  }
  assert.deepEqual(problems, [], `${problems.length} problems`);

  // Stateless: the same answers in the opposite order.
  for (let i = names.length - 1; i >= 0; i -= 7) assert.equal(displayName(names[i]), outs[i]);

  scored.sort((a, b) => b.n - a.n || b.out.length - a.out.length || (a.inp < b.inp ? -1 : 1));
  const perKind = new Map();
  const picked = scored.filter((x) => { // at most 8 of one kind, so the list shows what kinds of odd names there are
    if (x.n === 0) return false;
    perKind.set(x.kind, (perKind.get(x.kind) || 0) + 1);
    return perKind.get(x.kind) <= 8;
  }).slice(0, 40);
  const top = picked.map((x, k) => `${String(k + 1).padStart(2)}. [${x.n}] ${JSON.stringify(x.inp)}\n        -> ${JSON.stringify(x.out)}   ${x.why}`);
  t.diagnostic([
    `${names.length} distinct names from ${exams} exam-years${quick ? ' (centre lists only: NAMES_QUICK)' : ''}, read in ${loadMs} ms; displayName took ${ms.toFixed(0)} ms in all, ${(ms * 1000 / names.length).toFixed(1)} microseconds a name`,
    `${caseAndSpaceOnly} outputs differ from the input only in case and spaces; the other ${names.length - caseAndSpaceOnly} also had a mark, a dot, a bracket or a junk end tidied`,
    `the ${picked.length} most suspicious outputs, at most 8 of each kind (score in brackets):`,
    ...top,
  ].join('\n'));
  assert.ok(ms < 3000, `${ms} ms for ${names.length} names is too slow (one page render calls it once)`);
});

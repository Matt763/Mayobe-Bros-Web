// Which exams the importer knows, and where each one lives. Verified by the recon of 2026-11-10.
//  - onlinesys.necta.go.tz: NECTA's own server (2022 to 2025; backslashes in the CSEE 2022 index)
//  - matokeo.necta.go.tz: NECTA's newer server, same layout as onlinesys (2026 only; supported, not run yet)
//  - maktaba.tetea.org: a non-profit mirror of NECTA's HTML (2020 to 2022); links are flat, in the same folder
const ONLINESYS = 'onlinesys.necta.go.tz';
const MATOKEO = 'matokeo.necta.go.tz';
const MAKTABA = 'maktaba.tetea.org';

const WHERE = {
  'csee-2020': MAKTABA, 'csee-2021': MAKTABA, 'csee-2022': ONLINESYS, 'csee-2023': ONLINESYS, 'csee-2024': ONLINESYS, 'csee-2025': ONLINESYS,
  'acsee-2020': MAKTABA, 'acsee-2021': MAKTABA, 'acsee-2022': MAKTABA, 'acsee-2023': ONLINESYS, 'acsee-2024': ONLINESYS, 'acsee-2025': ONLINESYS, 'acsee-2026': MATOKEO,
  'psle-2020': MAKTABA, 'psle-2021': MAKTABA, 'psle-2022': ONLINESYS, 'psle-2023': ONLINESYS, 'psle-2024': ONLINESYS, 'psle-2025': ONLINESYS, 'psle-2026': MATOKEO,
  // Older years: only the Maktaba Tetea mirror still serves them (NECTA's own servers answer 404). One flat index lists every centre.
  // Added 2026-11-10 after recon: new-style pages (same table layout as 2020 to 2025), so the existing parsers are enough.
  'csee-2016': MAKTABA, 'csee-2017': MAKTABA, 'csee-2018': MAKTABA, 'csee-2019': MAKTABA,
  'psle-2013': MAKTABA, 'psle-2014': MAKTABA, 'psle-2015': MAKTABA, 'psle-2016': MAKTABA, 'psle-2017': MAKTABA, 'psle-2018': MAKTABA, 'psle-2019': MAKTABA,
  // Diploma (teachers' college) exams: one flat index, one page per college. DSEE 2014 to 2024 and DTE are on the Maktaba mirror, 2025 on NECTA onlinesys, 2026 on matokeo.
  'dsee-2014': MAKTABA, 'dsee-2015': MAKTABA, 'dsee-2016': MAKTABA, 'dsee-2017': MAKTABA, 'dsee-2018': MAKTABA, 'dsee-2019': MAKTABA, 'dsee-2020': MAKTABA, 'dsee-2021': MAKTABA, 'dsee-2022': MAKTABA, 'dsee-2023': MAKTABA, 'dsee-2024': MAKTABA, 'dsee-2025': ONLINESYS, 'dsee-2026': MATOKEO,
  'dpee-2026': MATOKEO, 'dppee-2026': MATOKEO, 'dspee-2026': MATOKEO, 'dte-2019': MAKTABA, 'dte-2020': MAKTABA,
  // QT (Qualifying Test): the whole year is ONE text page on the mirror (2015 exists only in the Wayback Machine and is not imported)
  'qt-2016': MAKTABA, 'qt-2017': MAKTABA, 'qt-2018': MAKTABA, 'qt-2019': MAKTABA, 'qt-2020': MAKTABA, 'qt-2021': MAKTABA, 'qt-2022': MAKTABA, 'qt-2023': MAKTABA,
  // Older FTNA (FTSEE 2014 to FTNA 2021) and SFNA (2015 to 2021): only the Maktaba mirror still serves them (necta-parse-ftna-sfna-old.mjs)
  'ftna-2014': MAKTABA, 'ftna-2015': MAKTABA, 'ftna-2016': MAKTABA, 'ftna-2017': MAKTABA, 'ftna-2018': MAKTABA, 'ftna-2019': MAKTABA, 'ftna-2020': MAKTABA, 'ftna-2021': MAKTABA, 'sfna-2015': MAKTABA, 'sfna-2016': MAKTABA, 'sfna-2017': MAKTABA, 'sfna-2018': MAKTABA, 'sfna-2019': MAKTABA, 'sfna-2020': MAKTABA, 'sfna-2021': MAKTABA,
  // FTNA (flat index, one page per centre) and SFNA (regions, districts, schools) on NECTA's own server
  'ftna-2022': ONLINESYS, 'ftna-2023': ONLINESYS, 'ftna-2024': ONLINESYS, 'ftna-2025': ONLINESYS,
  'sfna-2022': ONLINESYS, 'sfna-2023': ONLINESYS, 'sfna-2024': ONLINESYS, 'sfna-2025': ONLINESYS,
  // Old layouts (name column, one-line division totals): parsed by necta-parse-legacy.mjs
  'csee-2003': MAKTABA, 'csee-2004': MAKTABA, 'csee-2005': MAKTABA, 'csee-2006': MAKTABA, 'csee-2007': MAKTABA, 'csee-2008': MAKTABA, 'csee-2009': MAKTABA, 'csee-2010': MAKTABA, 'csee-2011': MAKTABA, 'csee-2012': MAKTABA, 'csee-2013': MAKTABA, 'csee-2014': MAKTABA, 'csee-2015': MAKTABA,
  'acsee-2005': MAKTABA, 'acsee-2006': MAKTABA, 'acsee-2007': MAKTABA, 'acsee-2009': MAKTABA, 'acsee-2010': MAKTABA, 'acsee-2011': MAKTABA, 'acsee-2012': MAKTABA, 'acsee-2013': MAKTABA, 'acsee-2014': MAKTABA, 'acsee-2015': MAKTABA,
  'acsee-2016': MAKTABA, 'acsee-2017': MAKTABA, 'acsee-2018': MAKTABA, 'acsee-2019': MAKTABA,
};
// index page name on the mirror (everything else is index.htm, PSLE is psle.htm)
const MAKTABA_INDEX = { 'psle-2014': 'psle2014.htm',
  'csee-2003': 'olevel.html', 'csee-2004': 'olevel.html', 'csee-2005': 'OLEVEL.html', 'csee-2013': 'olevel.html', 'csee-2014': 'olevel2014.htm', 'csee-2015': 'Olevel.htm',
  'acsee-2005': 'alevel.html', 'acsee-2006': 'alevel.html', 'acsee-2007': 'alevel.html', 'acsee-2009': 'alevel.html', 'acsee-2015': 'alevel.html', 'csee-2019': 'csee.htm', 'csee-2020': 'csee.htm', 'csee-2021': 'csee.htm' }; // the other secondary years use index.htm
const FULL = { dsee: 'Diploma in Secondary Education Examinations', dpee: 'DPEE', dppee: 'DPPEE', dspee: 'DSPEE', dte: 'Diploma in Technical Education', qt: 'Qualifying Test', ftna: 'Form Two National Assessment', sfna: 'Standard Four National Assessment', csee: 'Certificate of Secondary Education Examination', acsee: 'Advanced Certificate of Secondary Education Examination', psle: 'Primary School Leaving Examination' };

export const EXAM_IDS = Object.keys(WHERE);

/** Everything the importer needs to know about one exam id, or an Error. */
export function examDef(id) {
  const host = WHERE[id];
  if (!host) throw new Error(`Unknown exam "${id}". Known: ${EXAM_IDS.join(', ')}`);
  const [cat, y] = id.split('-');
  const year = Number(y);
  const primary = cat === 'psle' || cat === 'sfna';
  const kind = primary ? 'primary' : 'secondary';
  const diploma = ['dsee', 'dpee', 'dppee', 'dspee', 'dte'].includes(cat);
  const legacy = !primary && !diploma && cat !== 'qt' && host === MAKTABA && year <= 2015;
  const oldDefault = cat === 'csee' ? 'olevel.htm' : 'alevel.htm'; // 2006 to 2012 (CSEE) and 2010 to 2014 (ACSEE) use .htm
  const family = cat === 'ftna' || cat === 'sfna' || cat === 'qt' ? cat : diploma ? 'diploma' : ''; // own parsers: necta-parse-ftna-sfna.mjs, necta-parse-diploma.mjs (diploma + QT)
  const diplomaIndex = host === MAKTABA ? (cat === 'dte' ? (year === 2019 ? 'dte.htm' : 'index.htm') : year <= 2019 ? 'dsee.htm' : 'index.htm') : 'index.htm';
  const oldNational = (cat === 'ftna' || cat === 'sfna') && host === MAKTABA; // 2014 to 2021: own old-layout parsers
  const oldNationalIndex = cat === 'ftna' ? (year === 2014 ? 'formtwo-2014-2.htm' : year === 2015 ? 'formtwo-2015.html' : year === 2016 ? 'index.htm' : 'ftna.htm') : (year <= 2016 ? 'index.htm' : 'sfna.htm');
  const indexName = oldNational ? oldNationalIndex : cat === 'qt' ? (year === 2016 ? 'QT2016.html' : `qt${year}.htm`) : diploma ? diplomaIndex : family ? `${cat}.htm` : host === MAKTABA ? (MAKTABA_INDEX[id] || (primary ? 'psle.htm' : legacy ? oldDefault : 'index.htm')) : (primary ? 'psle.htm' : 'index.htm');
  const dir = host === MAKTABA ? (cat === 'dte' ? `https://${MAKTABA}/exam-results/DTE/${year}/` : `https://${MAKTABA}/exam-results/${id === 'ftna-2014' ? 'FTSEE2014-2' : cat.toUpperCase() + year}${id === 'csee-2012' ? '-2' : ''}/`) /* 2012: the re-scored results (CSEE2012-2), not the original */ : `https://${host}/results/${year}/${cat}/`;
  return {
    id, cat, category: cat.toUpperCase(), year, kind, host, source: host === MAKTABA ? 'maktaba' : 'necta',
    family,
    oldNational,
    legacy, // CSEE 2003 to 2015 and ACSEE 2005 to 2015: parseLegacyIndex / parseLegacyCentre
    oldPsle: primary && year <= 2019, // 2013 to 2019 pages need their own school parser (necta-parse-psle-old.mjs)
    fullName: FULL[cat], indexUrl: dir + indexName, baseDir: dir, indexName,
  };
}

/** Candidate-number separator and the prefix every candidate number of a centre must start with. */
export const cnoPrefix = (def, code) => code + (def.kind === 'primary' ? '-' : '/');

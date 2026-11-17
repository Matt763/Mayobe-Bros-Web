#!/usr/bin/env node
// Makes NECTA results posts (front matter only, `app: results`) and their luxe covers for exam-year pairs that do not have a post yet.
//   node scripts/tools/make-results-posts.mjs ftna:2014-2025 sfna:2015-2025 dsee:2014-2026 dte:2019-2020 qt:2015-2023 [--dry]
// Needs: headless Chromium (CHROME_BIN or ~/.cache/ms-playwright), cwebp, and `python3 -m http.server 8011 --bind 127.0.0.1 --directory scripts/tools` running.
// Cover: scripts/tools/results-post-art.html (?scene=<exam>-<year>&palette=&layout=). Alt text is written from the palette and layout actually used.
// Never overwrites a post or a cover that exists. Body stays empty on purpose (see CLAUDE.md, "Results search pages").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const EXAMS = {
  ftna: { abbr: 'FTNA', who: 'Form Two (FTNA)' },
  sfna: { abbr: 'SFNA', who: 'Standard Four (SFNA)' },
  dsee: { abbr: 'DSEE', who: 'Diploma in Secondary Education (DSEE)' },
  dpee: { abbr: 'DPEE', who: 'Teachers college diploma (DPEE)' },
  dppee: { abbr: 'DPPEE', who: 'Teachers college diploma (DPPEE)' },
  dspee: { abbr: 'DSPEE', who: 'Teachers college diploma (DSPEE)' },
  dte: { abbr: 'DTE', who: 'Diploma in Technical Education (DTE)' },
  qt: { abbr: 'QT', who: 'Qualifying Test (QT)' },
  csee: { abbr: 'CSEE', who: 'Form Four (CSEE)' },
  acsee: { abbr: 'ACSEE', who: 'Form Six (ACSEE)' },
  psle: { abbr: 'PSLE', who: 'Standard Seven (PSLE)' },
};
// palette name -> [base colour words, metal words]
const PALETTES = {
  'midnight-champagne': ['Deep midnight-blue', 'champagne-gold'], 'emerald-brass': ['Deep emerald-green', 'brass-gold'],
  'burgundy-rose-gold': ['Deep burgundy', 'rose-gold'], 'ink-platinum': ['Deep ink-blue', 'platinum'], 'onyx-copper': ['Near-black', 'copper'],
  'teal-pearl': ['Deep teal', 'pearl-gold'], 'aubergine-gold': ['Deep aubergine-purple', 'gold'], 'sapphire-silver': ['Deep sapphire-blue', 'silver'],
  'olive-bronze': ['Dark olive-green', 'bronze'], 'sienna-sand': ['Deep sienna-brown', 'sand-gold'], 'graphite-gold': ['Graphite-grey', 'gold'],
  'indigo-amber': ['Deep indigo', 'amber-gold'], 'mulberry-silver': ['Deep mulberry', 'silver'],
};
// layout name -> what the picture shows (verified by looking at renders; see the report of 2026-11-10)
const LAYOUTS = {
  gala: 'a thin double gold frame, a waving Tanzanian flag on a silver pole at the left and, centred on the right, the round NECTA logo above the words',
  'gala-right': 'a thin double gold frame, a waving Tanzanian flag on a silver pole at the right and, centred on the left, the round NECTA logo above the words',
  salon: 'the round NECTA logo and the words at the left and a waving Tanzanian flag inside a thin gilded arch at the right',
  'salon-left': 'a waving Tanzanian flag inside a thin arch at the left, with the round NECTA logo above the words at the right',
  monolith: 'the round NECTA logo and the words at the left, a waving Tanzanian flag on a silver pole at the upper right and a large hairline year along the bottom',
  'monolith-left': 'a large waving Tanzanian flag on a silver pole at the left, a thin vertical line, and the round NECTA logo above the words and a hairline year at the right',
  masthead: 'one wide gilded title line across the top under the round NECTA logo, a big hairline year at the bottom left and a waving Tanzanian flag at the bottom right',
};
const PAL = Object.keys(PALETTES), LAY = Object.keys(LAYOUTS);

function chrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const f = path.join(base, d, 'chrome-linux64/chrome');
    if (d.startsWith('chromium-') && fs.existsSync(f)) return f;
  }
  throw new Error('No Chromium found; set CHROME_BIN');
}

function dateFor(year) {
  const d = new Date(Date.UTC(2026, 10, 10));
  d.setUTCDate(d.getUTCDate() - Math.max(0, 2025 - year));
  return d.toISOString().slice(0, 10);
}

const made = [];
for (const arg of args) {
  const m = /^([a-z]+):(\d{4})-(\d{4})$/.exec(arg);
  if (!m || !EXAMS[m[1]]) throw new Error(`Bad argument "${arg}" (use exam:from-to, e.g. ftna:2014-2025)`);
  const [, exam, a, b] = m;
  const ex = EXAMS[exam];
  const offset = [...exam].reduce((n, c) => n + c.charCodeAt(0), 0);
  for (let year = Number(a), i = 0; year <= Number(b); year++, i++) {
    const slug = `necta-${exam}-results-${year}`;
    const file = path.join(ROOT, 'content/posts', `${slug}.md`);
    const cover = path.join(ROOT, 'assets/posts', `${slug}.webp`);
    if (fs.existsSync(file)) { console.log(`skip ${slug} (post exists)`); continue; }
    // neighbouring years never share a palette or a layout: steps of 5 and 3 are coprime with 13 and 7
    const palette = PAL[(offset + i * 5) % PAL.length], layout = LAY[(offset + i * 3) % LAY.length];
    const [base, metal] = PALETTES[palette];
    const alt = `${base} cover with ${metal} lettering: ${LAYOUTS[layout]} NECTA ${ex.abbr} Results ${year}`;
    const note = exam === 'ftna' && year === 2014 ? ' (the exam was called FTSEE that year)' : '';
    const front = `---
title: NECTA ${ex.abbr} RESULTS ${year} | MAYOBE BROS
date: ${dateFor(year)}
author: Mclean Mbaga
category: educational
label: results
app: results
section: [${exam}]
excerpt: ${ex.who} results for ${year}${note} from the National Examinations Council of Tanzania (NECTA), the national body that runs the ${ex.abbr} exam.
image: assets/posts/${slug}.webp
imageAlt: ${alt}
imageCredit: Cover drawn by Mayobe Bros. The NECTA logo belongs to the National Examinations Council of Tanzania.
tags: [necta, ${exam}, results]
---
`;
    if (dry) { console.log(`would make ${slug}  ${palette} / ${layout}`); continue; }
    const rendered = !fs.existsSync(cover);
    if (rendered) {
      const png = path.join(os.tmpdir(), `${slug}.png`);
      const url = `http://127.0.0.1:8011/results-post-art.html?scene=${exam}-${year}&palette=${palette}&layout=${layout}`;
      execFileSync(chrome(), ['--headless', '--no-sandbox', '--hide-scrollbars', `--screenshot=${png}`, '--window-size=1400,788', '--virtual-time-budget=4000', url], { stdio: 'ignore' });
      execFileSync('cwebp', ['-q', '90', '-m', '6', '-sharp_yuv', '-quiet', png, '-o', cover]);
      fs.unlinkSync(png);
      const kb = fs.statSync(cover).size / 1024;
      if (kb > 250) console.log(`  warning: ${slug}.webp is ${kb.toFixed(0)} KB (limit 250)`);
    }
    fs.writeFileSync(file, front);
    if (rendered) made.push({ slug, palette, layout });
    console.log(`made ${slug}  ${palette} / ${layout}`);
  }
}
if (made.length && !dry) {
  const doc = path.join(ROOT, 'docs/image-sources.md');
  const rows = made.map((r) => `| ${r.slug.replace('necta-', '').replace('-results-', ' ')} | luxe ${r.layout} | ${r.palette} (2026-11-10) |`).join('\n');
  fs.appendFileSync(doc, `\n<!-- covers added by scripts/tools/make-results-posts.mjs, ${new Date().toISOString().slice(0, 10)}: drawn in code, NECTA logo (owner's exception) -->\n${rows}\n`);
}

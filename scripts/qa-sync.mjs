#!/usr/bin/env node
// Save the questions readers asked in the comments, and the team's answers, into content/qa.json.
// The build then writes them into each post as plain HTML, so search engines can read and index them
// (comments are otherwise loaded by JavaScript after the page opens).
//
//   node scripts/qa-sync.mjs           fetch and write content/qa.json
//   node scripts/qa-sync.mjs --dry-run show what would be written
//
// Only approved comments that are questions (a question mark, or a question word such as how / what / je / vipi) and have at least one
// Team reply are kept, and only the Team replies under them. Praise and chat with a thank-you reply are skipped: they are not answers.
// Run it again after you reply to, hide or delete a comment: the file is rewritten from what is live, so hidden comments disappear.
// Needs no token: it reads the same public address the page uses. Then run `node scripts/build.mjs` and push.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeQuestion } from '../worker/src/question.js'; // a question mark, or a question word (English and Swahili)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const api = (process.env.MAYOBE_API || cfg.commentsApi || '').replace(/\/$/, '');
if (!api) { console.error('No comments address. Set "commentsApi" in site.config.json.'); process.exit(1); }

const slugs = fs.readdirSync(path.join(ROOT, 'content/posts')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
const get = async (p) => {
  const r = await fetch(`${api}/v1${p}`);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

const withComments = [];
for (let i = 0; i < slugs.length; i += 50) {
  const stats = await get(`/stats?slugs=${slugs.slice(i, i + 50).join(',')}`);
  for (const [slug, s] of Object.entries(stats)) if (s && s.c > 0) withComments.push(slug);
}

const safe = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, ' '); // server text is untrusted: no terminal escape sequences reach the screen
const posts = {};
let questions = 0, skipped = 0;
for (const slug of withComments.sort()) {
  const { comments = [] } = await get(`/posts/${slug}`);
  const kept = comments
    .filter((c) => !c.deleted) // a deleted question (blank name, placeholder text) is never published as a Q&A, even if it has a Team reply
    .map((c) => ({ id: c.id, name: c.name, body: c.body, at: c.at, replies: (c.replies || []).filter((r) => r.team).map((r) => ({ id: r.id, name: r.name, body: r.body, at: r.at })) }))
    .filter((c) => !c.team && c.replies.length);
  for (const c of kept.filter((c) => !looksLikeQuestion(c.body))) { skipped++; console.log(`  skipped (not a question): #${safe(c.id)} on ${safe(slug)}: ${safe(c.body).slice(0, 60)}`); }
  const asked = kept.filter((c) => looksLikeQuestion(c.body));
  if (asked.length) { posts[slug] = asked; questions += asked.length; }
}

console.log(`${slugs.length} posts checked, ${withComments.length} have comments, ${questions} answered question${questions === 1 ? '' : 's'} kept.`);
if (DRY) process.exit(0);
const file = path.join(ROOT, 'content/qa.json');
if (!questions) { if (fs.existsSync(file)) fs.rmSync(file); console.log('Nothing to save (content/qa.json removed if it existed).'); process.exit(0); }
fs.writeFileSync(file, JSON.stringify({ note: 'Written by scripts/qa-sync.mjs. Do not edit by hand.', posts }, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, file)}. Now run: node scripts/build.mjs`);

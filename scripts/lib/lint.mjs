// Quality checks for posts. These are warnings, not errors: they protect readability and AdSense approval.
// Run with the build (`node scripts/build.mjs`) or on its own (`node scripts/build.mjs --check`).

const AI_PHRASES = [
  "in today's fast-paced", 'fast-paced world', 'delve', 'tapestry', 'game-changer', 'game changer', 'unlock the', 'unlocking the', 'navigate the', 'navigating the',
  'leverage', 'robust', 'seamless', 'cutting-edge', 'revolutioniz', 'ever-evolving', 'it is important to note', "it's important to note", 'in conclusion',
  'picture this', "let's dive in", 'comprehensive guide', 'ultimate guide', 'holistic', 'empower', 'pivotal', 'a testament to', 'in the realm of', 'embark on',
  'beacon of', 'rich tapestry', 'transformative', 'meticulous', 'underscore', 'landscape of', 'at the end of the day', 'look no further', 'whether you are a',
];

function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

export function readability(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => /[a-z]/i.test(s));
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  if (!sentences.length || !words.length) return { grade: 0, avgSentence: 0 };
  const syl = words.reduce((a, w) => a + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  return { grade: Math.round(grade * 10) / 10, avgSentence: Math.round((words.length / sentences.length) * 10) / 10 };
}

export function lintPost(p, md = '') {
  const w = [];
  const body = p.text || '';
  if (p.words < 900) w.push(`only ${p.words} words; aim for 1,200 or more useful words`);
  if (p.words > 3800) w.push(`${p.words} words is very long; consider splitting it`);
  const r = readability(body);
  if (r.grade > 9.5) w.push(`reading grade ${r.grade} is high for "simple English" (aim for 8 or lower); average sentence is ${r.avgSentence} words`);
  if (r.avgSentence > 22) w.push(`sentences average ${r.avgSentence} words; shorten them`);
  const low = body.toLowerCase();
  const hits = AI_PHRASES.filter((ph) => low.includes(ph));
  if (hits.length) w.push(`AI-sounding phrases found: ${hits.slice(0, 6).join(', ')}`);
  const dashes = (p.html.match(/—/g) || []).length;
  if (dashes > 3) w.push(`${dashes} em dashes; use commas or full stops instead`);
  if (!/<h2[^>]*>[^<]*(sources|further reading|references)/i.test(p.html)) w.push('no "Sources and further reading" section');
  const external = (p.html.match(/<a [^>]*href="https?:\/\/(?!(?:www\.)?mayobebros\.com)/gi) || []).length;
  if (external < 1) w.push('no external source links; factual posts should cite real sources');
  if (/mayobebros\.com\/post\//i.test(p.html)) w.push('absolute links to mayobebros.com posts; use site-relative links like /post/...');
  const imgs = [...p.html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  imgs.forEach((t) => {
    const alt = (t.match(/\salt="([^"]*)"/) || [])[1];
    if (!alt || alt.length < 8) w.push(`image with missing/short alt text: ${(t.match(/src="([^"]+)"/) || [])[1]}`);
    if (alt && alt.length > 140) w.push(`alt text is long (${alt.length} chars)`);
  });
  if (p.image && !p.imageAlt) w.push('missing "imageAlt" for the featured image');
  const pct = (body.match(/\b\d{1,3}(?:\.\d+)?\s?%/g) || []).length;
  if (pct > 4) w.push(`${pct} percentages: every figure needs a real source in the text`);
  if (/\b(real story|true story|one student told|a student named|according to a recent study|studies show|research shows)\b/i.test(body)) w.push('contains story/study claims; keep only if you can cite a real source');
  // income promises are misleading and risky for AdSense; "not a way to get rich" style warnings are fine
  const promise = /\b(guaranteed|get rich|make \$?\d[\d,]*|earn \$?\d[\d,]*|become a millionaire|zero capital|no risk)\b/gi;
  for (const m of body.matchAll(promise)) {
    const before = body.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    if (/\b(not|never|no|without|cannot|can't|don't|avoid|beware|scam|fake|false|promise|could not|unverified|hype|if you|offers?)\b/.test(before)) continue;
    w.push(`income/guarantee wording: "…${body.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20).trim()}…" (AdSense treats promises of income as misleading)`);
    break;
  }
  if (/\b(old|earlier|older|previous) (version|post|article)\b|\bwe (have )?removed\b/i.test(body)) w.push('mentions an "old version" or what was removed; readers should only see the finished article');
  if (!/<h2/i.test(p.html)) w.push('no H2 headings; add sections so readers can scan');
  const paras = (p.html.match(/<p>[\s\S]*?<\/p>/g) || []).map((x) => x.replace(/<[^>]+>/g, '').split(/\s+/).length);
  const long = paras.filter((n) => n > 110).length;
  if (long > 2) w.push(`${long} very long paragraphs; split them`);
  return w;
}

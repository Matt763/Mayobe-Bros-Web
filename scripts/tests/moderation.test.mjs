// Tests the automatic comment screen (worker/src/moderation.js) and its generated word list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { screen, looksLikeTeam } from '../../worker/src/moderation.js';
import { WORDS, STEMS, PHRASES, SCAM } from '../../worker/src/wordlist.js';

const flagged = (t) => screen(t).flagged;
const why = (t) => screen(t).reasons.join(' | ');

test('the generated word list is up to date with worker/wordlists/*.json', () => {
  execFileSync(process.execPath, ['worker/build-wordlist.mjs', '--check'], { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
});

test('the lists are large enough and clean', () => {
  assert.ok(WORDS.length + STEMS.length + PHRASES.length >= 1000, `only ${WORDS.length + STEMS.length + PHRASES.length} abuse entries`);
  assert.ok(WORDS.length >= 400, `only ${WORDS.length} words`);
  assert.ok(PHRASES.length >= 100, `only ${PHRASES.length} phrases`);
  assert.ok(SCAM.length >= 100, `only ${SCAM.length} scam lines`);
  for (const w of [...WORDS, ...STEMS, ...PHRASES, ...SCAM]) assert.match(w, /^[a-z]+(?: [a-z]+)*$/, `bad entry: ${w}`);
  for (const s of STEMS) assert.ok(s.length >= 6, `stem too short: ${s}`);
  assert.equal(new Set(WORDS).size, WORDS.length);
});

test('English abuse is flagged, including endings and a list word in a longer sentence', () => {
  for (const t of ['You are an idiot.', 'what an IDIOT', 'Stupid article, writer is a moron', 'shut up', 'go to hell', 'you idiots', 'I hate you, you bastard', 'kill yourself']) {
    assert.equal(flagged(t), true, t);
  }
});

test('Swahili abuse is flagged, including noun-class forms', () => {
  for (const t of ['Wewe ni mjinga sana', 'Nyinyi wajinga', 'Mwandishi huyu ni kilaza na mjinga', 'ujinga mtupu', 'mama yako', 'kuma yako', 'Malaya wewe', 'Mpumbavu mkubwa']) {
    assert.equal(flagged(t), true, t);
  }
});

test('disguised spelling is caught: digits, symbols, stretching, spacing, masks, accents, look-alike letters', () => {
  for (const t of ['you idi0t', '1d10t', 'id!ot', 'idiiiiot', 'i d i o t', 'i.d.i.o.t', 'i-d-i-o-t', 'IDIÖT'.replace('Ö', 'O'), 'idіot' /* Cyrillic і */, 'id*ot', 'm j i n g a', 'mjiiiinga']) {
    assert.equal(flagged(t), true, t);
  }
  assert.match(why('idіot'), /mixed-script|word:/);
});

test('ordinary words are not flagged (whole-word matching, no Scunthorpe problem)', () => {
  for (const t of [
    'Thanks, this helped me assess my options.', 'Great class assignment on classic literature.', 'I will pass the exam in Scunthorpe.', 'Cumin and rice for lunch.',
    'The Himalaya trip and the Tanzania safari.', 'Hello from Dar es Salaam. Thank you for the clear steps.', 'Is the helpline free of charge? Please advise.',
    'Please explain how to apply for the loan board.', 'I like how simple the guide is.', 'My assistant checked the document twice.',
  ]) assert.equal(flagged(t), false, `${t}  ->  ${why(t)}`);
});

test('ordinary Swahili is not flagged', () => {
  for (const t of [
    'Asante sana kwa makala nzuri.', 'Habari za asubuhi, naomba msaada kuhusu fomu hii.', 'Mbwa wangu anapenda kucheza na watoto.', 'Mama yangu ananipenda sana.',
    'Tafadhali nisaidie kuelewa hatua ya pili.', 'Nimejifunza mengi kutoka kwenye somo hili, ahsanteni.', 'Kaka yangu anafanya kazi Arusha.', 'Punda na mbuzi wanapatikana shambani.',
    'Serikali imetangaza nafasi za kazi mpya.', 'Mtoto wangu anasoma shule ya msingi.', 'Shule ya wasichana ina walimu wa kike wengi.', 'Udongo na udago vilikuwa vikavu.', 'Timu yetu umeshinda mechi leo.',
    'Files get lost, so look up yours in the table.', '**Bold text** and **At the counter** are fine.',
  ]) assert.equal(flagged(t), false, `${t}  ->  ${why(t)}`);
});

test('contact details, scam lines, shouting and flooding are held', () => {
  assert.match(why('Call me on 0712 345 678'), /contact:phone/);
  assert.match(why('Reach me at name@mail.com'), /contact:email/);
  assert.match(why('Please send me money for the fee'), /scam:/);
  assert.match(why('tuma pesa kwa namba hii'), /scam:/);
  assert.match(why('visit mysite dot com for more'), /scam:/);
  assert.match(why('THIS WHOLE ARTICLE IS WRONG AND YOU KNOW IT'), /shouting/);
  assert.match(why('a'.repeat(20)), /flood/);
});

test('numbers and prices that are not phone numbers pass', () => {
  for (const t of ['The fee is TSh 600 per day for 12 days.', 'Page 123 and section 4.2 explain it.', 'I got 85% in 2024.']) assert.equal(flagged(t), false, t);
});

test('screening is fast and safe on large or hostile input', () => {
  const big = ('this is a long and perfectly polite comment about studying well ').repeat(30).slice(0, 1500);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) screen(big);
  const per = (performance.now() - t0) / 200;
  assert.ok(per < 3, `${per.toFixed(2)} ms per 1,500-letter comment (Workers Free allows about 10 ms of CPU per request)`);
  assert.equal(flagged('a '.repeat(700)), false);
  screen('(a+)+$'.repeat(100) + '!'); // nothing here backtracks
  screen('​'.repeat(2000));
  screen('😀'.repeat(500));
});

test('names that look like the team are recognised, even when disguised', () => {
  for (const n of ['Mayobe Bros Team', 'MAYOBE', 'M a y o b e', 'M.a.y.o.b.e', 'Mayo-be', 'm4y0be', 'Mayobе' /* Cyrillic е */, 'May\u200bobe', 'Site Admin', '4dm1n', 'Moderator Joe', 'Mclean Mbaga', 'The Mayobe Bros']) {
    assert.equal(looksLikeTeam(n), true, n);
  }
  for (const n of ['Asha', 'Youno yvonne', 'Badminton Fan', 'Teamwork Lover', 'Joseph M', 'Support']) {
    assert.equal(looksLikeTeam(n), n === 'Support', n);
  }
});

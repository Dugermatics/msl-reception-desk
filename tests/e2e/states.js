// State checks on the real demo page (headless Chrome, real Muse Spark calls):
// recognizer events are injected through the page's own handler (window.demo.inject),
// so each case is exact and repeatable. Covers: stale results, retry, duplicates,
// live candidates, unsupported words, MN/EN sync, language switch, reset.
//
//   node tests/e2e/states.js [--out results/states.json] [--shots dir]
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', path.join(__dirname, '..', '..', 'results', 'states.json'));
const SHOTS = arg('shots');
const URL = arg('url', 'http://127.0.0.1:8780/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sign = (label, state = 'committed', confidence = 0.9, reason = null) =>
  ({ type: 'sign', state, reason, label, confidence, top: [[label, confidence]], latency_ms: 10 });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL + '?lang=en');
  await page.waitForFunction(() => window.demo, null, { timeout: 30000 });
  await page.evaluate(() => window.demo.avatarApi());
  const snap = () => page.evaluate(() => window.demo.snapshot());
  const inject = (m) => page.evaluate((x) => window.demo.inject(x), m);
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const s = await snap(); if (fn(s)) return s; if (Date.now() - t0 > ms) return s; await sleep(150); } };
  const cases = [];
  const check = (name, ok, detail) => { cases.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };

  // 1. a confirmed message: sentence + English for the same message
  await inject(sign('hodood', 'committed', 0.97));
  await page.evaluate(() => window.demo.finalizePatient());
  let s = await until((x) => x.patient.en);
  check('confirmed sign -> sentence + English of the same message', s.patient.msg === 1 && s.patient.sentence !== '—' && s.patient.en
    && s.patient.en_for === `p1:${s.patient.sentence}`, s.patient);
  await shot('1_confirmed');

  // 2. next message starts with an uncertain sign: the old sentence and translation go at once
  await inject(sign('uuchlaarai', 'uncertain', 0.53, 'low_confidence'));
  s = await snap();
  check('new message clears previous sentence + English immediately', s.patient.msg === 2 && s.patient.sentence === '—' && s.patient.en === '', s.patient);
  check('uncertain sign -> retry bar, no sentence', s.patient.unsure && /\?/.test(s.patient.signs[0]), s.patient);
  await sleep(1500);
  s = await snap();
  check('no sentence or translation appears for an uncertain message', s.patient.sentence === '—' && s.patient.en === '', s.patient);
  await shot('2_uncertain');

  // 3. retry: the visitor signs again; same message number, sentence + English
  await page.click('#retry');
  await inject({ type: 'candidate', label: 'uuchlaarai', confidence: 0.62, agree: 0.7 });
  s = await snap();
  check('live candidate shown apart from recognized signs', s.patient.candidate.includes('%') && s.patient.pending === 0, s.patient);
  await shot('3_candidate');
  await inject(sign('uuchlaarai', 'committed', 0.86));
  s = await snap();
  check('candidate cleared when the sign is committed', s.patient.candidate === '', s.patient);
  // 4. duplicate (held gesture) is suppressed by the recognizer and ignored here
  await inject(sign('uuchlaarai', 'suppressed', 0.8, 'cooldown'));
  await inject(sign('dahin', 'committed', 0.95));
  s = await snap();
  check('retry continues the same message; duplicate ignored', s.patient.msg === 2 && s.patient.pending === 2 && s.patient.signs.length === 2, s.patient);
  await page.evaluate(() => window.demo.finalizePatient());
  s = await until((x) => x.patient.en);
  check('after retry: sentence + English, same message', s.patient.en && s.patient.en_for === `p2:${s.patient.sentence}`, s.patient);

  // 5. stale translation race: a new sign arrives while the translation is still in flight
  await inject(sign('bayarlalaa', 'committed', 0.93));
  await page.evaluate(() => window.demo.finalizePatient());
  await inject(sign('sain_baina_uu', 'uncertain', 0.41, 'low_confidence'));
  await sleep(6000);
  s = await snap();
  check('late translation never lands under a newer message', s.patient.msg === 4 && s.patient.en === '' && s.patient.sentence === '—', s.patient);
  await page.click('#retry');

  // 6. staff: unsupported words are text only, never shown as signed by the avatar
  const captions = new Set();
  const poll = setInterval(() => page.evaluate(() => window.demo.snapshot().avatar).then((a) => { if (a.caption) captions.add(a.caption); }).catch(() => {}), 100);
  const staffDone = page.evaluate(() => new Promise((res) => window.demo.onStaff(res)));
  await page.evaluate(() => window.demo.glossTyped('Баяртай, эрүүл болоорой.', 'typed'));
  const rec = await staffDone;
  await sleep(300);
  clearInterval(poll);
  s = await snap();
  check('staff: only supported signs played', JSON.stringify(rec.signs) === '["bayartai"]', rec);
  check('staff: unsupported words in the text-only box', /эрүүл/i.test(s.avatar.text_only) && /эрүүл/i.test(s.staff.text_only), s.avatar);
  check('avatar caption shows only performed signs', [...captions].length > 0 && [...captions].every((c) => !/эрүүл/i.test(c)), [...captions]);
  s = await until((x) => x.staff.en);
  check('staff English belongs to the shown sentence', s.staff.en && s.staff.en_for.endsWith(`:${s.staff.sentence}`), s.staff);
  check('staff timings recorded', rec.asr_ms === undefined && rec.model_ms > 0 && rec.check_ms >= 0 && rec.first_frame_ms != null, rec);
  await shot('6_unsupported');

  // 7. language switch keeps the same transcript and translation
  const before = await snap();
  await page.evaluate(() => window.demo.setLang('mn'));
  s = await snap();
  check('MN switch: same Mongolian + English text', s.staff.sentence === before.staff.sentence && s.staff.en === before.staff.en
    && s.patient.sentence === before.patient.sentence, { before: before.staff, after: s.staff });
  await shot('7_mn');
  await page.evaluate(() => window.demo.setLang('en'));

  // 8. reset
  await page.click('#reset');
  s = await snap();
  check('reset clears both panels and the transcript', s.history.length === 0 && s.staff.sentence === '—' && s.patient.sentence === '—'
    && s.patient.msg === 0 && s.avatar.text_only === '' && s.patient.signs.length === 0, s);
  await shot('8_reset');

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  const summary = { when: new Date().toISOString(), passed: cases.filter((c) => c.ok).length, total: cases.length, cases };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
  console.log(`${summary.passed}/${summary.total} passed`);
})();

// End-to-end run of the reception-desk dialogue (docs/demo_script.md) through
// the real demo page, in headless Chrome, with real model calls:
//   patient turns: a recorded rehearsal video -> recognizer server -> page -> /api/sign2text (Muse Spark)
//   staff turns:   recorded staff audio -> page's ASR WebSocket -> Speechmatics RT -> glossmap (Muse Spark) -> avatar
// The microphone is the only part replaced: the page's own ASR session is fed
// the recorded 16 kHz PCM in real time (100 ms chunks, silence in between).
//
//   node tests/e2e/conversation.js --run 1 --patient run1.avi --audio staff_audio
//        [--video out_dir] [--out results/e2e_run1.json]
//
// Needs: the demo server (python -m app.server) on :8780. The recognizer is
// started here, on the patient video, from RECOGNIZER_DIR (the private
// prototype) with its own Python; nothing is written by it.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RUN = arg('run', '1');
const PATIENT = arg('patient');
const AUDIO = arg('audio', 'staff_audio');
const OUT = arg('out', path.join(__dirname, '..', '..', 'results', `e2e_run${RUN}.json`));
const VIDEO = arg('video');
const URL = arg('url', 'http://127.0.0.1:8780/');
const RECOGNIZER_DIR = process.env.RECOGNIZER_DIR || '../msl-private/backend/LSTM';
const ONLY = ['sain_baina_uu', 'sonsgolgui', 'minii_manai', 'huuhed', 'uvduh', 'hodood', 'uuchlaarai', 'dahin', 'bayarlalaa'];

const SCRIPT = [
  { line: 1, who: 'patient', expect: ['sain_baina_uu', 'sonsgolgui'] },
  { line: 2, who: 'staff', wav: 'line01.wav', expect: ['sain_baina_uu', 'yasan_be'] },
  { line: 3, who: 'patient', expect: ['minii_manai', 'huuhed', 'uvduh'] },
  { line: 4, who: 'staff', wav: 'line02.wav', expect: ['uvduh'] },
  { line: 5, who: 'patient', expect: ['hodood'] },
  { line: 6, who: 'staff', wav: 'line03.wav', expect: ['oilgoloo', 'emch', 'huleeh'] },
  { line: 7, who: 'patient', expect: ['uuchlaarai', 'dahin'] },
  { line: 8, who: 'staff', replay: true, expect: ['oilgoloo', 'emch', 'huleeh'] },
  { line: 9, who: 'patient', expect: ['bayarlalaa'] },
  { line: 10, who: 'staff', wav: 'line04.wav', expect: ['bayartai'] },
];

function wavPcm(file) {               // 16 kHz mono s16le WAV -> PCM bytes
  const b = fs.readFileSync(file);
  let o = 12;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'data') return b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

function waitFor(list, n, ms, what) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (list.length >= n) { clearInterval(iv); resolve(list[n - 1]); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${what}`)); }
    }, 50);
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...(VIDEO ? { recordVideo: { dir: VIDEO, size: { width: 1600, height: 900 } } } : {}) });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const staff = [], patient = [];
  await page.exposeFunction('__staff', (r) => staff.push({ ...r, at: Date.now() }));
  await page.exposeFunction('__patient', (r) => patient.push({ ...r, at: Date.now() }));
  await page.goto(URL);
  await page.waitForFunction(() => window.demo, null, { timeout: 30000 });
  await page.evaluate(() => window.demo.avatarApi());
  await page.evaluate(() => { window.demo.onStaff((r) => window.__staff(r)); window.demo.onPatient((r) => window.__patient(r)); });
  await page.evaluate(async () => { window.__asr = await window.demo.startSpeechmatics({ test: true }); });

  // Screen-consistency watch (every 150 ms for the whole run): an English line must belong to the
  // sentence above it (same event key), and the avatar caption may only name a sign being performed.
  const avatarNames = await page.evaluate(async () => (await (await fetch('/api/config')).json()).avatar_signs
    .flatMap((x) => [x.mn, (x.en || '').toUpperCase()]).filter(Boolean));
  const violations = [], captions = new Set();
  let watchOn = true;
  const watcher = (async () => {
    while (watchOn) {
      const v = await page.evaluate(() => window.demo.snapshot()).catch(() => null);
      if (v) {
        if (v.staff.en && !v.staff.en_for.endsWith(`:${v.staff.sentence}`)) violations.push({ kind: 'staff_en_mismatch', ...v.staff });
        if (v.patient.en && v.patient.en_for !== `p${v.patient.msg}:${v.patient.sentence}`) violations.push({ kind: 'patient_en_stale', ...v.patient });
        if (v.avatar.caption) { captions.add(v.avatar.caption); if (!avatarNames.includes(v.avatar.caption)) violations.push({ kind: 'caption_not_a_sign', caption: v.avatar.caption }); }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  })();

  // Open-mic pump: silence, or the current staff line, in real time.
  const SILENCE = Buffer.alloc(3200);
  let current = null, pos = 0, stopPump = false;
  const pump = (async () => {
    let next = Date.now();
    while (!stopPump) {
      let chunk = SILENCE;
      if (current) { chunk = current.subarray(pos, pos + 3200); pos += 3200; if (pos >= current.length) current = null; }
      if (chunk.length < 3200) chunk = Buffer.concat([chunk, SILENCE.subarray(chunk.length)]);
      await page.evaluate((b64) => window.__asr.feed(b64), chunk.toString('base64')).catch(() => {});
      next += 100;
      await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
    }
  })();

  const rec = spawn(path.join(RECOGNIZER_DIR, '.venv', 'Scripts', 'python.exe'),
    ['recognize_server.py', '--model', process.env.RECOGNIZER_MODEL || 'sign_language_hackathon_v8.h5', '--source', PATIENT, '--only', ...ONLY],
    { cwd: RECOGNIZER_DIR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  rec.stderr.on('data', () => {});
  rec.stdout.on('data', () => {});

  const turns = [];
  let s = 0, p = 0;
  try {
    for (const turn of SCRIPT) {
      const t0 = Date.now();
      let got;
      if (turn.who === 'patient') {
        got = await waitFor(patient, ++p, 120000, `patient line ${turn.line}`);
        const ok = JSON.stringify(got.signs.map((x) => x.label)) === JSON.stringify(turn.expect);
        const used = got.uncertain && got.uncertain.length ? got.signs.filter((x) => !got.uncertain.some((u) => u.label === x.label)) : got.signs;
        // Outcome as the staff sees it: correct sentence / "please repeat" / a wrong sign shown as certain.
        const committed = got.signs.filter((x) => !x.uncertain).map((x) => x.label);
        const wrongShown = committed.filter((l) => !turn.expect.includes(l));
        const anyUnsure = got.signs.some((x) => x.uncertain);
        const outcome = wrongShown.length ? 'wrong' : anyUnsure || committed.length < turn.expect.length ? 'retry'
          : JSON.stringify(committed) === JSON.stringify(turn.expect) ? 'correct' : 'wrong';
        turns.push({ line: turn.line, who: 'patient', expect: turn.expect, recognized: got.signs, text: got.text, source: got.source,
          verified: got.verified, uncertain: got.uncertain, labels_correct: ok, outcome, wrong_shown: wrongShown,
          duplicates_suppressed: got.suppressed || 0, recog_ms: got.recog_ms,
          sign_to_text_ms: got.sign_to_text_ms, llm_ms: got.llm_ms, used: used.map((x) => x.label) });
      } else if (turn.replay) {
        const r = await page.evaluate(async () => {
          const lp = window.demo.state().lastPlayed;
          const t = performance.now();
          const timing = await window.demo.playSigns(lp.ids, [], lp.caption);
          return { ids: lp.ids, ...timing, wall_ms: Math.round(performance.now() - t) };
        });
        turns.push({ line: turn.line, who: 'staff', replay: true, expect: turn.expect, signs: r.ids, signs_correct: JSON.stringify(r.ids) === JSON.stringify(turn.expect),
          load_ms: r.load_ms, first_frame_ms: r.first_frame_ms, total_ms: r.total_ms });
      } else {
        await new Promise((r) => setTimeout(r, 800));        // a natural pause before answering
        current = wavPcm(path.join(AUDIO, turn.wav)); pos = 0;
        got = await waitFor(staff, ++s, 90000, `staff line ${turn.line}`);
        turns.push({ line: turn.line, who: 'staff', expect: turn.expect, sentence: got.sentence, signs: got.signs, rejected: got.rejected,
          text: got.text, verified: got.verified, signs_correct: JSON.stringify(got.signs) === JSON.stringify(turn.expect),
          asr_ms: got.asr_ms, llm_ms: got.llm_ms, model_ms: got.model_ms, check_ms: got.check_ms, attempts: got.attempts,
          load_ms: got.load_ms, first_frame_ms: got.first_frame_ms, avatar_total_ms: got.total_ms,
          speech_to_avatar_ms: got.speech_to_avatar_ms });
        // unsupported words: shown in the text-only box once the avatar is done
        const v = await page.evaluate(() => window.demo.snapshot());
        const last = turns[turns.length - 1];
        last.text_only_shown = v.avatar.text_only;
        last.text_only_ok = (got.text || []).every((w) => v.avatar.text_only.includes(w));
      }
      const last = turns[turns.length - 1];
      console.log(`run ${RUN} line ${turn.line} ${turn.who}: ${JSON.stringify(last)}`);
      last.turn_ms = Date.now() - t0;
    }
  } catch (err) {
    console.error(`run ${RUN} stopped: ${err.message}`);
    turns.push({ error: err.message });
  } finally {
    watchOn = false;
    await watcher;
    stopPump = true;
    await pump;
    rec.kill();
    if (VIDEO) await page.screenshot({ path: path.join(VIDEO, `e2e_run${RUN}_final.png`) }).catch(() => {});
    await context.close();
    await browser.close();
    const summary = {
      run: RUN, patient_video: path.basename(PATIENT || ''), when: new Date().toISOString(), page_errors: pageErrors,
      staff_lines_correct: turns.filter((t) => t.who === 'staff' && t.signs_correct).length,
      staff_lines: turns.filter((t) => t.who === 'staff').length,
      patient_lines_correct: turns.filter((t) => t.who === 'patient' && t.labels_correct).length,
      patient_lines: turns.filter((t) => t.who === 'patient').length,
      patient_outcomes: ['correct', 'retry', 'wrong'].reduce((o, k) => ({ ...o, [k]: turns.filter((t) => t.outcome === k).length }), {}),
      completed: !turns.some((t) => t.error) && turns.length === SCRIPT.length,
      screen_violations: violations.slice(0, 20), screen_violation_count: violations.length, captions_seen: [...captions],
      turns,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
    console.log(`run ${RUN}: screen violations ${violations.length}, captions ${[...captions].join(' | ')}`);
    console.log(`run ${RUN}: staff ${summary.staff_lines_correct}/${summary.staff_lines}, patient labels ${summary.patient_lines_correct}/${summary.patient_lines} ${JSON.stringify(summary.patient_outcomes)}, completed ${summary.completed}`);
  }
})();

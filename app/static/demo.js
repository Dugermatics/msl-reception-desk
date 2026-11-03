// Reception-desk demo: staff speech -> avatar signs, Deaf visitor signs -> staff text.
// The avatar is the private prototype page in an iframe (same origin), driven
// through its window.signAvatar API; its animation code is not changed here.
//
// Spoken input stays Mongolian and the sign language stays MSL. The EN/MN switch
// changes the interface language only; the English line under a confirmed
// Mongolian sentence is a subtitle for international viewers. Uncertain or
// unverified results are never translated or turned into sentences.

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
let CFG = null;

// ---------------------------------------------------------------------------
// Interface language
// ---------------------------------------------------------------------------
const I18N = {
  en: {
    title: 'Hospital Reception · Two-way MSL Interpreter',
    scope: 'Relays communication only. No diagnosis or medical advice.',
    staff_title: 'Staff → Deaf Visitor', staff_sub: 'Mongolian speech → MSL',
    patient_title: 'Deaf Visitor → Staff', patient_sub: 'MSL → Mongolian text',
    recognized_speech: 'Recognized Speech (Mongolian)', gloss_seq: 'MSL Gloss Sequence',
    text_only: 'Shown as text (no sign available)', avatar_title: '3D Signing Avatar',
    recognized_signs: 'Recognized Signs', confidence: 'Recognition Confidence',
    uncertain_repeat: 'Uncertain Sign — Please Repeat', retry: 'Retry',
    mn_interp: 'Mongolian Interpretation', en_trans: 'English Translation',
    replay: '↻ Replay signs', send: 'Send now', clear: 'Clear', tts: 'Read aloud', signing: 'signing…',
    mic_start: '🎤 Speak', mic_stop: '■ Stop', typed_ph: 'Type instead (fallback)',
    who_staff: 'Staff', who_patient: 'Deaf visitor', replayed: '(replayed)', as_text: '[text]',
    unclear_hist: '(uncertain — asked to repeat)',
    track_no_body: 'Step into the camera frame', track_no_hands: 'Hands not visible — keep both hands in frame',
    reason_low_confidence: 'low confidence', reason_inconsistent: 'unstable', reason_hands_not_visible: 'hands not visible',
    reason_out_of_frame: 'left the frame', reason_too_close: 'too close to the camera', reason_too_far: 'too far from the camera',
    track_too_close: 'Too close — step back so the camera sees you down to the waist', track_too_far: 'Too far — step closer to the camera',
    unknown_sign: 'unknown sign',
    w_uncertain: (s) => `Not sure about: ${s}. No sentence is written until it is signed again.`,
    w_glosses: 'No sentence generated: showing the recognized signs directly.',
    w_none: 'No sign recognized with confidence.',
    w_model_failed: 'Model did not respond: showing the staff member\'s words as text.',
    w_not_verified: 'Failed the checks: nothing is signed, showing text.',
    w_rejected: 'Unsupported signs are never played.',
    w_clip: 'Could not load the sign clips. Showing text.',
    w_server: 'Could not reach the server: text only.',
    w_asr: 'ASR server unreachable.', w_asr_fallback: 'Web Speech can be selected instead.',
    w_retry: 'Please sign again.',
    unsupported: 'unsupported', recog_on: 'Recognizer v7 · connected', recog_off: 'Recognizer · offline',
    lat_staff: (s) => `Speech → avatar starts: ${s}`, lat_patient: (s) => `Sign → text: ${s}`,
    thinking: 'Muse Spark…',
    reset: 'New session', not_signed: 'Text only — not signed', candidate: 'Live candidate · not confirmed',
    msg_no: (n) => `· message ${n}`,
  },
  mn: {
    title: 'Эмнэлгийн хүлээн авах · MSL хоёр талын орчуулга',
    scope: 'Зөвхөн харилцааг дамжуулна. Онош, эмнэлгийн зөвлөгөө өгөхгүй.',
    staff_title: 'Ажилтан → Сонсголгүй иргэн', staff_sub: 'монгол яриа → дохио',
    patient_title: 'Сонсголгүй иргэн → Ажилтан', patient_sub: 'дохио → монгол текст',
    recognized_speech: 'Танигдсан яриа', gloss_seq: 'Дохионы дараалал (MSL)',
    text_only: 'Текстээр (дохио байхгүй)', avatar_title: '3D дохионы аватар',
    recognized_signs: 'Танигдсан дохио', confidence: 'Итгэлцүүр',
    uncertain_repeat: 'Тодорхойгүй дохио — дахин дохиолно уу', retry: 'Дахин',
    mn_interp: 'Монгол орчуулга', en_trans: 'Англи орчуулга',
    replay: '↻ Дахин үзүүлэх', send: 'Илгээх', clear: 'Цэвэрлэх', tts: 'Дуугаар унших', signing: 'дохио…',
    mic_start: '🎤 Ярих', mic_stop: '■ Зогсоох', typed_ph: 'Бичиж оруулах (нөөц)',
    who_staff: 'Ажилтан', who_patient: 'Иргэн', replayed: '(давтав)', as_text: '[текст]',
    unclear_hist: '(тодорхойгүй — дахин дохиолохыг хүссэн)',
    track_no_body: 'Камерын кадрт орно уу', track_no_hands: 'Гар харагдахгүй байна — хоёр гараа кадрт байлгана уу',
    reason_low_confidence: 'итгэл бага', reason_inconsistent: 'тогтворгүй', reason_hands_not_visible: 'гар харагдаагүй',
    reason_out_of_frame: 'кадраас гарсан', reason_too_close: 'камерт хэт ойр', reason_too_far: 'камераас хэт хол',
    track_too_close: 'Хэт ойр байна — бүсэлхий хүртэл харагдахаар хойш алхана уу', track_too_far: 'Хэт хол байна — камерт ойртоно уу',
    unknown_sign: 'үл мэдэгдэх дохио',
    w_uncertain: (s) => `Тодорхойгүй: ${s}. Дахин дохиолох хүртэл өгүүлбэр бичихгүй.`,
    w_glosses: 'Өгүүлбэр үүсгээгүй: танигдсан дохиог шууд харуулж байна.',
    w_none: 'Итгэлтэй танигдсан дохио алга.',
    w_model_failed: 'Загвар хариу өгсөнгүй: ажилтны үгийг текстээр харуулж байна.',
    w_not_verified: 'Шалгалтад тэнцээгүй: дохио үзүүлэхгүй, текстээр харуулж байна.',
    w_rejected: 'Дэмжигдээгүй дохиог тоглуулахгүй.',
    w_clip: 'Дохионы бичлэг ачаалж чадсангүй. Текстээр харуулж байна.',
    w_server: 'Сервертэй холбогдож чадсангүй: зөвхөн текст.',
    w_asr: 'ASR сервертэй холбогдож чадсангүй.', w_asr_fallback: 'Web Speech руу шилжүүлж болно.',
    w_retry: 'Дахин дохиолно уу.',
    unsupported: 'дэмжигдээгүй', recog_on: 'Recognizer v7 · холбогдсон', recog_off: 'Recognizer · холбогдоогүй',
    lat_staff: (s) => `Яриа → аватар эхлэх: ${s}`, lat_patient: (s) => `Дохио → текст: ${s}`,
    thinking: 'Muse Spark…',
    reset: 'Шинэ яриа', not_signed: 'Зөвхөн текст — дохиолоогүй', candidate: 'Шууд таамаг · баталгаажаагүй',
    msg_no: (n) => `· мессеж ${n}`,
  },
};
function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
const qs = new URLSearchParams(location.search);
let LANG = qs.get('lang') || storageGet('msl-lang') || 'en';
if (!I18N[LANG]) LANG = 'en';
const t = (k, ...a) => { const v = I18N[LANG][k] ?? I18N.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };

function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('typed-input').placeholder = t('typed_ph');
  $('mic').textContent = mic ? t('mic_stop') : t('mic_start');
  $('lang-en').classList.toggle('on', LANG === 'en');
  $('lang-mn').classList.toggle('on', LANG === 'mn');
  if (CFG) { renderPending(); rerenderStaffChips(); renderMsgNo(); }
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  LANG = b.dataset.lang; storageSet('msl-lang', LANG); applyLang();
}));

// Demo mode (default) hides developer details; ?dev=1 or the "dev" button shows them.
if (qs.get('dev') === '1') document.body.classList.remove('demo');
$('dev-toggle').addEventListener('click', () => document.body.classList.toggle('demo'));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
function logClient(ev) { post('/api/log', ev).catch(() => {}); }
function chip(text, cls = '', note = '', title = '') {
  const el = document.createElement('span');
  el.className = `chip ${cls}`;
  el.textContent = text;
  if (title) el.title = title;
  if (note) { const s = document.createElement('small'); s.textContent = note; el.appendChild(s); }
  return el;
}
const sec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

/** English subtitle for confirmed Mongolian text only. Fills `el` when it arrives; a failure leaves it empty. */
async function subtitle(text, el, dir, key = text) {
  el.textContent = '';
  if (!text) return '';
  const want = String(key);
  el.dataset.for = want;
  try {
    const r = await post('/api/translate', { text, dir });
    if (el.dataset.for === want) el.textContent = r.en || '';
    return r.en || '';
  } catch (_) { return ''; }
}

function addHistory(who, text, extra = '', en = null) {
  const li = document.createElement('li');
  li.className = who;
  const w = document.createElement('span');
  w.className = 'who';
  w.textContent = who === 'staff' ? t('who_staff') : t('who_patient');
  li.appendChild(w);
  li.appendChild(document.createTextNode(text + (extra ? `  ${extra}` : '')));
  const e = document.createElement('span');
  e.className = 'en';
  li.appendChild(e);
  $('history').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
  if (en) en.then((s) => { e.textContent = s ? `— ${s}` : ''; });
}

// Sign names: MN -> Mongolian word; EN -> English gloss in capitals (the usual way to write sign glosses).
const avatarName = (id) => { const s = CFG.avatar_names[id]; return s ? (LANG === 'en' && s.en ? s.en.toUpperCase() : s.mn) : id; };
const recogName = (id) => { const s = CFG.recog_names[id]; return s ? (LANG === 'en' && s.en ? s.en.toUpperCase() : s.mn) : id; };
const recogMn = (id) => (CFG.recog_names[id] ? CFG.recog_names[id].mn : id);

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
const avatarFrame = $('avatar');
let avatarReady = null;
function avatarApi() {
  if (!avatarReady) {
    avatarReady = new Promise((resolve) => {
      const tick = () => {
        const w = avatarFrame.contentWindow;
        if (w && w.signAvatar && w.signAvatar.bones && w.signAvatar.bones.LeftHand) {
          // Show only the avatar: hide the prototype's own panels (CSS only).
          const st = w.document.createElement('style');
          st.textContent = '#ui, #word-list { display: none !important; }';
          w.document.head.appendChild(st);
          resolve(w.signAvatar);
        } else setTimeout(tick, 200);
      };
      tick();
    });
  }
  return avatarReady;
}
avatarApi();

let avatarQueue = Promise.resolve();
let lastPlayed = null;

function setAvatarText(text) {
  $('avatar-textonly-text').textContent = text || '';
  $('avatar-textonly').hidden = !text;
}

/** Play checked sign ids in order; textOnly = the words that have no sign (shown apart, never as signed).
 *  Resolves with timings once the avatar is back at rest. */
function playSigns(ids, chipEls, textOnly) {
  const job = avatarQueue.then(async () => {
    const A = await avatarApi();
    const t0 = now();
    let clips;
    try {
      clips = await Promise.all(ids.map(async (id) => { const d = await A.loadClip(id); d.label = id; return d; }));
    } catch (err) {
      $('staff-warn').textContent = t('w_clip');
      $('avatar-caption').textContent = '';
      setAvatarText(textOnly);
      return { error: String(err) };
    }
    const tLoaded = now();
    setAvatarText(textOnly);
    const done = A.playSequence(clips);
    // Track which sign is playing (chip highlight) and the first animated frame.
    let firstFrame = null, idx = -1;
    await new Promise((resolve) => {
      let finished = false;
      done.then(() => { finished = true; });
      const watch = () => {
        const st = A.playbackState();
        if (st && firstFrame === null) firstFrame = now();
        if (st) {
          const i = ids.indexOf(st.label, Math.max(idx, 0));
          if (i >= 0 && i !== idx) {
            if (idx >= 0 && chipEls[idx]) chipEls[idx].className = 'chip done';
            idx = i;
            if (chipEls[idx]) chipEls[idx].className = 'chip playing';
            $('avatar-caption').textContent = avatarName(ids[idx]);
          }
        }
        if (finished) { chipEls.forEach((c) => { c.className = 'chip done'; }); $('avatar-caption').textContent = ''; resolve(); } else requestAnimationFrame(watch);
      };
      watch();
    });
    return { load_ms: Math.round(tLoaded - t0), first_frame_ms: firstFrame ? Math.round(firstFrame - t0) : null, total_ms: Math.round(now() - t0) };
  });
  avatarQueue = job.catch(() => {});
  return job;
}

// ---------------------------------------------------------------------------
// Staff -> Deaf visitor
// ---------------------------------------------------------------------------
let staffShown = null;   // last result, to re-render chips on a language switch
let staffTurn = 0;

/** A new staff utterance started: the previous result must not stay on screen under it. */
function startStaffTurn(text) {
  staffTurn++;
  staffShown = null;
  $('staff-sentence').textContent = text || '…';
  $('staff-sentence').classList.add('provisional');
  $('staff-en').textContent = ''; $('staff-en').dataset.for = '';
  $('staff-signs').innerHTML = ''; $('staff-text').textContent = '';
  $('staff-warn').textContent = ''; $('staff-latency').textContent = '';
  setAvatarText('');
}
function rerenderStaffChips() {
  if (!staffShown) return;
  const box = $('staff-signs');
  const states = [...box.querySelectorAll('.chip:not(.rejected)')].map((c) => c.className);
  box.innerHTML = '';
  staffShown.chips = staffShown.r.signs.map((id, i) => { const c = chip(avatarName(id), states[i] || ''); box.appendChild(c); return c; });
  (staffShown.r.rejected || []).forEach((id) => box.appendChild(chip(id, 'rejected', t('unsupported'))));
}

async function showGloss(r, timing = {}) {
  const turn = staffTurn;
  $('staff-sentence').textContent = r.sentence;
  $('staff-sentence').classList.remove('provisional');
  const en = subtitle(r.sentence, $('staff-en'), 'staff', `s${turn}:${r.sentence}`);   // the staff's words are confirmed ASR text
  const box = $('staff-signs');
  box.innerHTML = '';
  const chips = r.signs.map((id) => chip(avatarName(id)));
  chips.forEach((c) => box.appendChild(c));
  (r.rejected || []).forEach((id) => box.appendChild(chip(id, 'rejected', t('unsupported'))));
  staffShown = { r, chips };
  $('staff-text').textContent = (r.text || []).join(' · ');
  const warn = [];
  if (r.error) warn.push(t('w_model_failed'));
  else if (!r.verified) warn.push(t('w_not_verified'));
  if ((r.rejected || []).length) warn.push(t('w_rejected'));
  $('staff-warn').textContent = warn.join(' ');
  addHistory('staff', r.sentence, r.signs.length ? `[${r.signs.map(avatarName).join(' · ')}]` : t('as_text'), en);
  const textOnly = (r.text || []).join(' · ');
  let av = {};
  if (r.signs.length) {
    lastPlayed = { ids: r.signs, caption: textOnly };
    $('replay').disabled = false;
    av = await playSigns(r.signs, staffShown.chips, textOnly);
  } else {
    setAvatarText(textOnly);
  }
  const tm = { asr_ms: r.asr_ms ?? timing.asr_ms, llm_ms: r.llm_ms, model_ms: r.model_ms, check_ms: r.check_ms,
    attempts: r.attempts, ...av };
  $('staff-timings').textContent = Object.entries(tm).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k} ${v}`).join('  ·  ');
  // end of speech -> avatar's first frame = ASR finalisation + model + clip load
  const startMs = r.signs.length && av.first_frame_ms != null ? (tm.asr_ms || 0) + (r.llm_ms || 0) + av.first_frame_ms : null;
  $('staff-latency').textContent = startMs != null ? t('lat_staff', sec(startMs)) : '';
  const rec = { dir: 'staff', sentence: r.sentence, signs: r.signs, rejected: r.rejected, text: r.text, verified: r.verified,
    speech_to_avatar_ms: startMs, ...tm };
  logClient(rec);
  staffListeners.forEach((f) => f(rec));
}
const staffListeners = [];

async function glossTyped(text, source, extra = {}) {
  finalizePatient();   // the staff answering ends the visitor's turn
  startStaffTurn(text);
  $('partial').textContent = t('thinking');
  try {
    const r = await post('/api/gloss', { text, source });
    $('partial').innerHTML = '&nbsp;';
    await showGloss(r, extra);
  } catch (err) {
    $('partial').innerHTML = '&nbsp;';
    $('staff-sentence').textContent = text;
    $('staff-warn').textContent = t('w_server');
    setAvatarText(text);
    addHistory('staff', text, t('as_text'));
  }
}

$('typed').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('typed-input').value.trim();
  if (v) { $('typed-input').value = ''; glossTyped(v, 'typed'); }
});
$('replay').addEventListener('click', () => {
  if (!lastPlayed) return;
  const box = $('staff-signs');
  box.innerHTML = '';
  const chips = lastPlayed.ids.map((id) => chip(avatarName(id)));
  chips.forEach((c) => box.appendChild(c));
  addHistory('staff', t('replayed'), `[${lastPlayed.ids.map(avatarName).join(' · ')}]`);
  playSigns(lastPlayed.ids, chips, lastPlayed.caption);
});

// --- Speechmatics via the server (browser mic -> 16 kHz PCM over a WebSocket)
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.buffer.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm16', Pcm16);`;

let mic = null;   // {stop()}

async function startSpeechmatics({ test = false } = {}) {
  const ws = new WebSocket(`ws://${location.host}/api/asr`);
  ws.binaryType = 'arraybuffer';
  let ready = false;
  let stream = null, ctx = null;
  if (!test) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm16');
    node.port.onmessage = (e) => { if (ready && ws.readyState === 1) ws.send(e.data); };
    src.connect(node);
  }
  let finals = '';
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'ready') { ready = true; $('asr-badge').className = 'badge ok'; }
    else if (m.type === 'partial') $('partial').textContent = (finals + ' ' + m.text).trim();
    else if (m.type === 'final') { finals = (finals + ' ' + m.text).trim(); $('partial').textContent = finals; }
    else if (m.type === 'utterance_end') { finals = ''; finalizePatient(); startStaffTurn(m.text); $('partial').textContent = t('thinking'); }
    else if (m.type === 'gloss') { $('partial').innerHTML = '&nbsp;'; showGloss(m); }
    else if (m.type === 'error') {
      $('asr-badge').className = 'badge down';
      $('staff-warn').textContent = `Speechmatics: ${m.text}. ${t('w_asr_fallback')}`;
    }
  };
  ws.onclose = () => { if (mic) { stopMic(); $('asr-badge').className = 'badge down'; } };
  ws.onerror = () => { $('staff-warn').textContent = t('w_asr'); };
  await new Promise((resolve, reject) => {
    const tm = setTimeout(() => reject(new Error('ASR did not start')), 10000);
    const iv = setInterval(() => { if (ready) { clearTimeout(tm); clearInterval(iv); resolve(); } }, 50);
  });
  return {
    // Automated tests only: send recorded 16 kHz PCM instead of the microphone.
    feed(base64) { if (ws.readyState === 1) ws.send(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer); },
    stop() {
      try { ws.readyState === 1 && ws.send('stop'); } catch (_) { /* closed */ }
      setTimeout(() => ws.close(), 3000);   // let the last utterance finish
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      if (ctx) ctx.close();
    },
  };
}

// --- Web Speech fallback (browser's own recognizer; text then goes through the same /api/gloss)
function startWebSpeech() {
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Impl) throw new Error('Web Speech API not available');
  const rec = new Impl();
  rec.lang = 'mn-MN'; rec.continuous = true; rec.interimResults = true;
  let on = true;
  rec.onresult = (ev) => {
    let fin = '', interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
    }
    if (interim) $('partial').textContent = interim;
    if (fin.trim()) glossTyped(fin.trim(), 'webspeech');
  };
  rec.onend = () => { if (on) try { rec.start(); } catch (_) { /* already started */ } };
  rec.onerror = (e) => { $('staff-warn').textContent = `Web Speech: ${e.error}`; };
  rec.start();
  $('asr-badge').className = 'badge ok';
  return { stop() { on = false; rec.stop(); } };
}

function stopMic() {
  if (mic) mic.stop();
  mic = null;
  $('mic').classList.remove('live');
  $('mic').textContent = t('mic_start');
}

$('mic').addEventListener('click', async () => {
  if (mic) { stopMic(); return; }
  $('staff-warn').textContent = '';
  try {
    mic = $('asr-mode').value === 'speechmatics' ? await startSpeechmatics() : startWebSpeech();
    $('mic').classList.add('live');
    $('mic').textContent = t('mic_stop');
  } catch (err) {
    mic = null;
    $('staff-warn').textContent = `Mic / ASR: ${err.message}`;
  }
});
// --- Video demo player (?staffplay=1). The staff side is one person's recorded voice, so a
// recorded line is played through the speakers AND its PCM is streamed in real time into the
// same Speechmatics session the microphone would use. Transcription, glossmap, checks and the
// avatar all run live; nothing downstream is prepared. The microphone is not used in this mode.
const STAFFPLAY = qs.get('staffplay') === '1';
let playCtx = null, playPcm = null, playPos = 0, pumpTimer = null;

function wavToPcm(buf) {                 // 16 kHz mono s16le WAV -> Uint8Array of the data chunk
  const v = new DataView(buf);
  if (v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 16000 || v.getUint16(34, true) !== 16) {
    throw new Error('expected 16 kHz mono 16-bit WAV');
  }
  for (let p = 12; p + 8 <= buf.byteLength;) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const size = v.getUint32(p + 4, true);
    if (id === 'data') return new Uint8Array(buf, p + 8, Math.min(size, buf.byteLength - p - 8));
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

async function ensurePlayerSession() {
  if (mic && pumpTimer) return;
  mic = await startSpeechmatics({ test: true });
  const session = mic;
  const CHUNK = 3200;                    // 100 ms of 16 kHz s16
  const silence = new Uint8Array(CHUNK);
  pumpTimer = setInterval(() => {        // real-time pace; silence between lines lets end-of-utterance fire
    if (mic !== session) { clearInterval(pumpTimer); pumpTimer = null; return; }
    let chunk = silence;
    if (playPcm) {
      chunk = new Uint8Array(CHUNK);
      chunk.set(playPcm.subarray(playPos, playPos + CHUNK));
      playPos += CHUNK;
      if (playPos >= playPcm.length) playPcm = null;
    }
    let s = '';
    for (let i = 0; i < chunk.length; i++) s += String.fromCharCode(chunk[i]);
    session.feed(btoa(s));
  }, 100);
}

async function playStaffLine(n, btn) {
  if (playPcm) return;                   // one line at a time
  $('staff-warn').textContent = '';
  try {
    await ensurePlayerSession();
    const pcm = wavToPcm(await (await fetch(`/api/staffplay/${n}`, { cache: 'no-store' })).arrayBuffer());
    playCtx = playCtx || new AudioContext();
    if (playCtx.state === 'suspended') await playCtx.resume();
    const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)));
    const ab = playCtx.createBuffer(1, samples.length, 16000);
    const ch = ab.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
    const src = playCtx.createBufferSource();
    src.buffer = ab;
    src.connect(playCtx.destination);
    btn.classList.add('playing');
    src.onended = () => btn.classList.remove('playing');
    playPos = 0; playPcm = pcm;          // the pump streams it from the next tick
    src.start();
    logClient({ kind: 'staffplay', line: n });
  } catch (err) {
    $('staff-warn').textContent = `Demo player: ${err.message}`;
  }
}

function setupStaffPlay() {
  if (!STAFFPLAY) return;
  if (!CFG.asr || !CFG.staffplay || !CFG.staffplay.length) {
    $('staff-warn').textContent = 'Demo player: needs SPEECHMATICS_API_KEY and STAFF_AUDIO_DIR on the server.';
    return;
  }
  $('mic').hidden = true;
  $('asr-mode').value = 'speechmatics';
  $('asr-mode').disabled = true;
  const box = $('staffplay-buttons');
  for (const { n, text } of CFG.staffplay) {
    const b = document.createElement('button');
    b.textContent = `${n} ▶ ${text}`;
    b.addEventListener('click', () => playStaffLine(n, b));
    box.appendChild(b);
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < box.children.length) box.children[i].click();
  });
  $('staffplay').hidden = false;
}

$('asr-mode').addEventListener('change', () => {
  $('asr-badge').textContent = $('asr-mode').value === 'speechmatics' ? 'ASR: Speechmatics (mn)' : 'ASR: Web Speech (mn-MN)';
  if (mic) stopMic();
});

// ---------------------------------------------------------------------------
// Deaf visitor -> staff
// ---------------------------------------------------------------------------
// The recognizer publishes each closed sign segment with a state:
//   committed  - passed confidence, margin, temporal-consistency and hands-visible checks
//   uncertain  - failed one of them (reason given); shown in amber, never sent to the model
//   suppressed - the same sign again inside the cooldown (a held or split gesture); ignored
// Signers put their hands down between signs, so a message is final only after a
// longer rest, or as soon as the staff starts to answer. While every sign is
// committed a provisional sentence is shown after each one; once any sign is
// uncertain no sentence is written until the visitor re-signs (Retry).
const FINALIZE_MS = 5000;
let pending = [];              // signs of the current message, in order (the raw sequence, kept apart from the sentence)
let finalizeTimer = null;
let signingNow = false;
let recogTimes = [];
let composeSeq = 0;            // latest provisional request
let provisional = null;        // {seq, n, r}: result for the first n pending signs
let patientLatencies = [];     // per sign: event arrival -> provisional text shown (ms)
let suppressed = 0;
let retryOpen = false;         // after Retry the next sign continues the same message
let msgNo = 0;                 // patient message counter: everything shown belongs to message msgNo

function renderMsgNo() { $('patient-msgno').textContent = msgNo ? t('msg_no', msgNo) : ''; }
function showCandidate(m) {
  if (!m || !m.label) { $('candidate').hidden = true; return; }
  $('candidate-text').textContent = `${recogName(m.label)} ${Math.round(m.confidence * 100)}%`;
  $('candidate').hidden = false;
}
/** First sign of a new message: the previous message's sentence, translation and warnings go away at once. */
function startPatientMessage() {
  msgNo++;
  renderMsgNo();
  clearPatientText();
  $('patient-warn').textContent = ''; $('patient-latency').textContent = ''; $('patient-unsure').hidden = true;
}

const isUnsure = (s) => s.uncertain || !CFG.recog_names[s.label] || s.confidence < CFG.conf_min;
const forModel = () => pending.map(({ label, confidence, uncertain }) => ({ label, confidence, uncertain: !!uncertain }));

function clearPatientText() {
  $('patient-sentence').textContent = '—';
  $('patient-sentence').classList.remove('provisional');
  $('patient-en').textContent = '';
  $('patient-en').dataset.for = '';
}

async function composeProvisional() {
  const seq = ++composeSeq;
  const n = pending.length;
  if (pending.some(isUnsure)) {   // no sentence around a gap
    provisional = null;
    clearPatientText();
    showPatientWarnings({ source: pending.every(isUnsure) ? 'none' : 'uncertain' });
    return;
  }
  const tEvent = pending[n - 1]._arrived;
  try {
    const r = await post('/api/sign2text', { signs: forModel(), provisional: true });
    if (seq !== composeSeq || n !== pending.length) return;   // a newer sign arrived meanwhile
    provisional = { seq, n, r };
    patientLatencies.push(Math.round(now() - tEvent));
    $('patient-sentence').textContent = r.text || '…';
    $('patient-sentence').classList.add('provisional');
    $('patient-en').textContent = '';
    showPatientWarnings(r);
    $('patient-latency').textContent = t('lat_patient', sec(patientLatencies[patientLatencies.length - 1]));
  } catch (_) { /* finalize will retry or fall back to glosses */ }
}

function showPatientWarnings(r) {
  const unsure = pending.filter(isUnsure);
  $('patient-unsure').hidden = !unsure.length;
  const warn = [];
  if (unsure.length) warn.push(t('w_uncertain', unsure.map(chipLabel).join(', ')));
  else if (r.source === 'glosses') warn.push(t('w_glosses'));
  else if (r.source === 'none') warn.push(t('w_none'));
  $('patient-warn').textContent = warn.join(' ');
}

function chipLabel(s) {
  if (!s.label) return `? (${t('reason_' + s.reason) || s.reason})`;
  if (!CFG.recog_names[s.label]) return `${s.display || s.label} (${t('unknown_sign')})`;
  return recogName(s.label) + (s.uncertain || s.confidence < CFG.conf_min ? '?' : '');
}

function renderPending() {
  const box = $('patient-signs');
  box.innerHTML = '';
  for (const s of pending) {
    const unsure = isUnsure(s);
    const note = s.label ? `${Math.round(s.confidence * 100)}%` : '';
    const why = unsure && s.reason ? ` · ${t('reason_' + s.reason)}` : '';
    box.appendChild(chip(s.label ? recogName(s.label) + (unsure ? '?' : ' ✓') : '?', unsure ? 'uncertain' : 'confirmed',
      note + why, s.label ? recogMn(s.label) : ''));
  }
}

function scheduleFinalize() {
  clearTimeout(finalizeTimer);
  finalizeTimer = setTimeout(() => { if (signingNow) scheduleFinalize(); else finalizePatient(); }, FINALIZE_MS);
}

const finalListeners = [];

function resetPending() {
  pending = []; recogTimes = []; patientLatencies = []; provisional = null; composeSeq++;
}

async function finalizePatient() {
  clearTimeout(finalizeTimer);
  if (!pending.length) return;
  const signs = forModel();
  const n = pending.length;
  const recog = recogTimes;
  const shown = patientLatencies;
  const prov = provisional;
  const anyUnsure = pending.some(isUnsure);
  resetPending();
  let r;
  if (prov && prov.n === n) r = prov.r;          // the provisional text already covers every sign
  else {
    try {
      r = await post('/api/sign2text', { signs });   // the server also refuses a sentence around an uncertain sign
    } catch (err) {
      r = anyUnsure ? { text: '', source: 'uncertain', glosses: [], uncertain: signs.filter((s) => s.uncertain) }
        : { text: signs.map((s) => recogMn(s.label)).join(', '), source: 'glosses', uncertain: [], llm_ms: null };
    }
  }
  const confirmed = r.source === 'model' && r.verified && !anyUnsure;
  $('patient-sentence').classList.remove('provisional');
  $('patient-sentence').textContent = r.text || '—';
  $('patient-unsure').hidden = !anyUnsure;
  $('patient-warn').textContent = anyUnsure ? t('w_retry') : r.source === 'glosses' ? t('w_glosses') : r.source === 'none' ? t('w_none') : '';
  // English only for a checked model sentence; plain glosses or uncertain results are not dressed up as English sentences
  const en = confirmed ? subtitle(r.text, $('patient-en'), 'patient', `p${msgNo}:${r.text}`) : null;
  if (!confirmed) $('patient-en').textContent = '';
  $('patient-timings').textContent = [`recog_ms ${recog.join('/')}`, `sign→text_ms ${shown.join('/')}`,
    r.llm_ms != null ? `llm_ms ${r.llm_ms}` : null, suppressed ? `suppressed ${suppressed}` : null].filter(Boolean).join('  ·  ');
  const glosses = (r.glosses || []).map(recogName);
  addHistory('patient', r.text || t('unclear_hist'), `[${glosses.join(' · ')}${anyUnsure ? ' · ?' : ''}]`, en);
  const rec = { dir: 'patient', msg: msgNo, signs, text: r.text, source: r.source, verified: r.verified, uncertain: r.uncertain,
    recog_ms: recog, sign_to_text_ms: shown, llm_ms: r.llm_ms, suppressed };
  suppressed = 0;
  logClient(rec);
  finalListeners.forEach((f) => f(rec));
  if (confirmed) speak(r.text);
}

$('send-now').addEventListener('click', finalizePatient);
$('clear').addEventListener('click', () => {
  clearTimeout(finalizeTimer); resetPending(); renderPending(); clearPatientText();
  $('patient-warn').textContent = ''; $('patient-unsure').hidden = true; });
// Retry: drop the uncertain signs, keep the confirmed ones, and wait for the visitor to sign again.
$('retry').addEventListener('click', () => {
  pending = pending.filter((s) => !isUnsure(s));
  provisional = null; composeSeq++; retryOpen = true;
  renderPending(); clearPatientText();
  $('patient-unsure').hidden = true;
  $('patient-warn').textContent = t('w_retry');
  logClient({ dir: 'patient', action: 'retry', kept: pending.map((s) => s.label) });
  if (pending.length) { composeProvisional(); scheduleFinalize(); } else clearTimeout(finalizeTimer);
});

function setTracking(state) {
  const el = $('track');
  const msg = state && state !== 'ok' ? t('track_' + state) : '';
  el.textContent = msg;
  el.classList.toggle('on', !!msg);
}

function connectRecognizer() {
  $('cam').src = `${CFG.recognizer_url}/stream`;
  const es = new EventSource(`${CFG.recognizer_url}/events`);
  es.onopen = () => { $('recog-badge').className = 'badge ok'; $('recog-badge').textContent = t('recog_on'); };
  es.onerror = () => { $('recog-badge').className = 'badge down'; $('recog-badge').textContent = t('recog_off'); };
  es.onmessage = (e) => handleRecog(JSON.parse(e.data));
}

function handleRecog(m) {
  if (m.type === 'status') {
    signingNow = !!m.signing;
    $('signing').classList.toggle('on', signingNow);
    if (!signingNow) showCandidate(null);
    if ('tracking' in m) setTracking(m.tracking);
  } else if (m.type === 'tracking') {
    setTracking(m.state);
  } else if (m.type === 'candidate') {
    showCandidate(m);
  } else if (m.type === 'sign') {
    showCandidate(null);
    if (m.state === 'suppressed') { suppressed++; logClient({ dir: 'patient', action: 'suppressed', label: m.label }); return; }
    if (!pending.length && !retryOpen) startPatientMessage();
    retryOpen = false;
    m._arrived = now();
    m.uncertain = m.state === 'uncertain';   // an older recognizer without states: the confidence gate still applies
    pending.push(m);
    recogTimes.push(m.latency_ms);
    renderPending();
    composeProvisional();
    scheduleFinalize();
  }
}

// New session: clear both directions and the transcript (the mic and the recognizer keep running).
function resetSession() {
  clearTimeout(finalizeTimer); resetPending(); suppressed = 0; msgNo = 0; retryOpen = false;
  renderPending(); renderMsgNo(); clearPatientText(); showCandidate(null);
  $('patient-warn').textContent = ''; $('patient-latency').textContent = ''; $('patient-unsure').hidden = true;
  $('patient-timings').textContent = '';
  staffTurn++; staffShown = null; lastPlayed = null; $('replay').disabled = true;
  $('staff-sentence').textContent = '—'; $('staff-sentence').classList.remove('provisional');
  $('staff-en').textContent = ''; $('staff-en').dataset.for = '';
  $('staff-signs').innerHTML = ''; $('staff-text').textContent = ''; $('staff-warn').textContent = '';
  $('staff-latency').textContent = ''; $('staff-timings').textContent = ''; $('partial').innerHTML = '&nbsp;';
  $('avatar-caption').textContent = ''; setAvatarText('');
  $('history').innerHTML = '';
  logClient({ action: 'reset' });
}
$('reset').addEventListener('click', resetSession);

// --- Optional Mongolian TTS: only if the browser has a Mongolian voice.
let mnVoice = null;
function pickVoice() {
  mnVoice = (speechSynthesis.getVoices() || []).find((v) => /^mn/i.test(v.lang)) || null;
  $('tts').disabled = !mnVoice;
  $('tts').parentElement.title = mnVoice ? mnVoice.name : 'No Mongolian voice installed (text only)';
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!text || !mnVoice || !$('tts').checked) return;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = mnVoice; u.lang = mnVoice.lang;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------------------
applyLang();
(async () => {
  CFG = await (await fetch('/api/config')).json();
  CFG.recog_names = Object.fromEntries(CFG.recognizer_signs.map((s) => [s.id, { mn: s.mn.split(' (')[0], en: (s.en || '').split(' (')[0] }]));
  CFG.avatar_names = Object.fromEntries(CFG.avatar_signs.map((s) => [s.id, { mn: s.mn, en: s.en }]));
  $('model-badge').textContent = CFG.model;
  $('asr-badge').textContent = CFG.asr ? 'ASR: Speechmatics (mn)' : 'ASR: Web Speech (mn-MN)';
  if (!CFG.asr) $('asr-mode').value = 'webspeech';
  connectRecognizer();
  applyLang();
  setupStaffPlay();
  // Hooks for tests/e2e (the UI never uses them).
  window.demo = {
    glossTyped, finalizePatient, playSigns, avatarApi, startSpeechmatics,
    onStaff: (f) => staffListeners.push(f), onPatient: (f) => finalListeners.push(f),
    replay: () => $('replay').click(), state: () => ({ pending: pending.length, lastPlayed }),
    setLang: (l) => { LANG = l; applyLang(); },
    inject: handleRecog, reset: resetSession,
    snapshot: () => ({
      staff: { sentence: $('staff-sentence').textContent, en: $('staff-en').textContent, en_for: $('staff-en').dataset.for || '',
        signs: [...$('staff-signs').children].map((c) => c.textContent), text_only: $('staff-text').textContent },
      avatar: { caption: $('avatar-caption').textContent, text_only: $('avatar-textonly').hidden ? '' : $('avatar-textonly-text').textContent },
      patient: { msg: msgNo, sentence: $('patient-sentence').textContent, en: $('patient-en').textContent, en_for: $('patient-en').dataset.for || '',
        signs: [...$('patient-signs').children].map((c) => c.textContent), unsure: !$('patient-unsure').hidden,
        candidate: $('candidate').hidden ? '' : $('candidate-text').textContent, pending: pending.length },
      history: [...$('history').children].map((li) => li.textContent),
    }),
  };
})();

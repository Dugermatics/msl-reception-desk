# Two-way MSL reception desk: integration report (2026-11-03)

Real end-to-end runs of the demo dialogue (`docs/demo_script.md`, 10 lines) through the actual demo page, with real model calls (Muse Spark Open on Baseten, Speechmatics real-time `mn`). Reproduce with `tests/e2e/conversation.js`; summary with `python tests/e2e/summarize.py`.

## What is integrated

| Direction | Chain | Status |
|---|---|---|
| Staff → patient | browser mic → Speechmatics RT (server-side key) → `glossmap.py` (Muse Spark + rule and meaning checks) → playable-sign gate (vocabulary ∩ avatar `clip_allowlist.json`) → avatar `playSequence` | working, tested with a real browser mic (Chrome fake-audio device) and in 3 full runs |
| Fallbacks | Web Speech `mn-MN`; typed input; text-only when the model fails or a sign is unsupported | working (unit tests + ASR-down test) |
| Patient → staff | webcam → recognizer v8 (local, closed 9-sign vocabulary) → confidence gate (≥ 0.5) → `sign2text.py` (Muse Spark + deterministic no-added-content check) → staff screen | working, 3 full runs on a held-out rehearsal |
| Speech output | browser Mongolian voice only if installed | none installed on this PC: text only |

The avatar animation is the frozen RC3 (`avatar-rc3` + the clip allow-list commit); `avatar-rc4` (11-03) changes only the mesh (piercings removed), not the motion. The demo page embeds it unchanged and drives it through `window.signAvatar`.

## Update 2026-11-03 (afternoon): video demo player, avatar mesh, training summary

**Video demo player** (`/?staffplay=1`, enabled only when the server has `STAFF_AUDIO_DIR`)
- The demo has one person, the developer, who signs the patient side live. The staff side uses the developer's own recorded staff lines.
- Keys 1–4 play a recorded line through the speakers and stream the same audio in real time (100 ms chunks, silence in between) into the page's live Speechmatics session, the same path the end-to-end tests use. Transcription, sign mapping, both checks and the avatar run live; no transcript, gloss or result is prepared in advance.
- The page shows "Staff speech: pre-recorded audio · Live AI processing" while this mode is on. The microphone button is hidden in this mode; without `?staffplay=1` the page is unchanged.
- Check in a headless browser (keys 1–4, real model calls): 4/4 staff lines gave the expected signs and passed both checks on the first attempt; end of speech → avatar 3.4 s on line 10. `tests/e2e/states.js` still passes 17/17.

**Avatar mesh (`avatar-rc4`, private prototype).** The ear rings (3 upper, 2 lobe) and the nose ring were removed from the avatar mesh. The motion is unchanged: avatar checks 24/24 on the demo clips and 270/288 on every clip, the same as RC3.

**Recognizer training during the event (private prototype).** 8 training iterations of the same small LSTM on a local CPU, about 119,000 steps and about 1 hour of training in total (the logs of 3 early retrains on 10-31 were overwritten, so the true total is slightly higher). Each round added data: new demo signs, webcam recordings, seated recordings of the demo signer, and in v8 framing augmentation. The Meta models were not fine-tuned; they are used through their APIs.

## Update 2026-11-03: recognizer v8, line 6 reworded, final end-to-end runs

**Changes**
- **Recognizer v8.** Retrained with seated webcam recordings of the demo signer, plus framing augmentation (each training sequence also moved ±8 % and scaled ±15 %), because the model reads absolute frame coordinates.
  - Scores against v7, as committed correct / committed wrong / held for retry:
    - seated held-out: 18/0/0 for both
    - the held-out rehearsal `webcam_demo3`: v7 22/3/4, v8 23/2/4 (both v8 "wrong" are unlabelled warm-up gestures, not demo signs)
    - a live session with the signer sitting lower than in training: v7 5/2/2, v8 5/1/3
  - Framing normalization at run time gave no clear gain, so it stays off.
- **Line 6 reworded** to "Ойлголоо. Эмчийг түр хүлээнэ үү." Every word is now carried by a sign (ОЙЛГОЛОО · ЭМЧ · ХҮЛЭЭХ), so there is no text-only fragment and no verb form for the ASR to get wrong. The new recording was transcribed correctly, and `eval_demo.py` passes 16/16, all on the first attempt.
- **End of utterance 0.7 s → 1.0 s.** The staff member's natural pause after "Ойлголоо." (0.85 s) split line 6 into two utterances. 1.0 s keeps it as one, at a cost of +0.3 s latency.

**Three consecutive bidirectional runs** (`results/e2e_v4_run*.json`, same held-out rehearsal, cut into 3 runs as before):

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Staff lines: expected signs | 5/5 | 5/5 | 5/5 |
| Staff lines passed on the first model attempt | 5/5 | 5/5 | 5/5 |
| Patient lines: correct / retry / wrong | 5 / 0 / 0 | 4 / 1 / 0 | 5 / 0 / 0 |
| Screen violations, page errors | 0 | 0 | 0 |

- Patient side: 14/15 correct, against 7/15 on 11-02, and no wrong sign shown as certain. The one retry (run 2, line 3) is МИНИЙ at 0.49 plus a ХҮҮХЭД segment that was not confident; the page asked to repeat it.

**Latency** (12 spoken staff lines, 24 patient sign events):

| Stage | Median | Max |
|---|---|---|
| ASR: end of speech → final text (incl. 1.0 s end-of-utterance silence) | 0.67 s | 2.18 s |
| Muse Spark Open: glossmap + checks | 3.97 s | 5.61 s |
| **Staff: end of speech → avatar starts signing** | **4.71 s** | **7.57 s** |
| **Patient: sign → provisional sentence** | **1.77 s** | **3.75 s** |

The 11-02 tail of 12–19 s (line 6 retries) is gone.

## Update 2026-11-02: recognition reliability, English support, demo mode

**What changed**
- **Recognizer (private, `recognize_server.py`)**
  - A sign segment now ends only when the wrists (pose) are back down. Before, a short drop-out of the hand landmarks also ended it, so one held sign could split into several segments and repeat its label.
  - Each segment gets a state:
    - `committed`: mean prob ≥ 0.5, top-1 minus top-2 ≥ 0.25, ≥ 60 % of windows agree on the label, and hand landmarks present on ≥ 35 % of raised frames.
    - `uncertain`: failed one of these checks; the reason is sent with it.
    - `suppressed`: the same label again within 1.5 s of the last one.
  - A segment where the signer leaves the frame (0.6 s) or a raised wrist loses its hand for 1 s is dropped as uncertain.
  - The page receives the tracking state (`no_body`, `no_hands`) as soon as it changes.
- **sign2text:** when any sign in a message is uncertain, no sentence is written (`source: "uncertain"`). Before, the model wrote a fluent sentence from the remaining signs.
- **Page**
  - EN/MN interface switch. Spoken input stays Mongolian and the signs stay MSL.
  - An English line appears under confirmed Mongolian text only: the staff's recognized speech and checked patient sentences. It comes from `/api/translate` (Muse Spark Open). Uncertain results are never translated.
  - The raw recognized sign sequence (with confidence) is shown apart from the generated sentence.
  - Uncertain signs are shown dashed, with a reason. An "Uncertain Sign — Please Repeat" bar has a Retry button, which drops the uncertain signs and keeps the confirmed ones.
  - Out-of-frame and hands-not-visible banners appear on the camera.
  - Demo mode is the default: timings, typed input and the ASR selector are hidden (`?dev=1` or the "dev" button shows them). The camera preview is larger, the avatar caption has its own bar under the avatar instead of covering the hands, and a one-line latency shows per turn.
  - The avatar itself is unchanged (frozen RC3).

**Re-run of the same three held-out runs** (webcam_demo3 cut again the same way; `results/e2e_v2_run*.json`):

| Patient lines (15) | Correct sentence | "Please repeat" | Wrong sign shown as certain |
|---|---|---|---|
| Before (conf gate 0.5 only) | 9 | 4 | 2 |
| After | 7 | 7 | 1 |

- Staff lines: 15/15 correct in both.
- Duplicate predictions: none in either version on these recordings. The repeats seen in the live session on 11-02 did not reproduce offline. The hand-dropout fix and the cooldown target them, but they still need a live check.
- The remaining wrong sign is УУЧЛААРАЙ read as БАЯРЛАЛАА at 0.78, with full agreement and margin. No gate can catch it; only more training data can.
- The stricter gate turns errors into retries. Most of the extra retries are correct signs in the 0.5–0.6 band (МИНИЙ, ХҮҮХЭД, УУЧЛААРАЙ). Loosening the gate (margin 0.2, agreement 0.5) brings back the ХҮҮХЭД→СОНСГОЛГҮЙ error.
- The gate thresholds were chosen on this same rehearsal, so they are not independently validated.

## Update 2026-11-02 (evening): state consistency, unsupported words, latency, final validation

**Fixes**
- **Recognition state**
  - A live candidate (classified every 10 frames while signing) is shown on its own line, labelled "not confirmed". It is never used for text and is cleared when the sign closes.
  - Committed signs have a ✓ and a solid border; uncertain signs are dashed amber with a reason.
  - Each patient message and staff utterance gets its own number. When a new one starts, the previous sentence and English line are cleared at once.
  - Each English line is keyed to its event, so a translation that arrives late is dropped. Retry continues the same message.
- **Camera distance (recognizer)**
  - A live session found the signer 1.7× closer than in every training clip: shoulder width 0.61–0.75 of the frame, against 0.35–0.43 in all 241 clips. At that distance САЙН_БАЙНА_УУ was read as ХҮҮХЭД and СОНСГОЛГҮЙ as МИНИЙ, with confidence 0.8–0.99.
  - Outside 0.28–0.50 the camera now shows "Too close — step back" (or "too far"), and the signs from that distance are marked uncertain.
- **Held hand after a sign (recognizer)**
  - A segment with only one decoded run is now judged on the whole segment. Before, a hand resting at the chest after САЙН_БАЙНА_УУ won as ХҮҮХЭД 0.86; it is now uncertain (agreement 0.4).
  - Replaying webcam_demo3 gives the same result as before: 18 correct, 1 wrong, 9 held.
- **Unsupported words**
  - The avatar caption names only the sign being performed.
  - Words without a sign appear in a separate "Text only — not signed" box under the avatar, and in the staff panel.
- **Interface**
  - Added a "New session" reset. The layout was checked at 1920×1080.
  - Rows can no longer overlap: the Retry bar used to cover the sign chips, as seen in the 11-02 recording.
- **Timings**
  - Muse Spark generation (`model_ms`) and validation (`check_ms`: rule checks plus the Muse Spark meaning check) are now recorded separately, together with ASR, avatar first frame and `speech_to_avatar_ms`.

**State checks** (`tests/e2e/states.js`, real page and real model calls, injected recognizer events): **17/17 pass**. Cases covered:
- stale sentence or translation after a new message, including a translation still in flight
- uncertain sign → Retry → same message
- duplicate suppression
- candidate shown apart from signs
- unsupported words in the text-only box, never in the caption
- MN/EN switch keeps the same text
- reset
- no page errors

**Three consecutive bidirectional rehearsals** (`results/e2e_v3_run*.json`, the same held-out rehearsal cut as above):

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Staff lines: expected signs | 3/5 ¹ | 5/5 | 5/5 |
| Patient lines: correct / retry / wrong | 3 / 2 / 0 | 3 / 2 / 0 | 1 / 4 / 0 |
| Screen violations (English not matching its sentence, stale result, caption not a sign; checked every 150 ms) | 0 | 0 | 0 |
| Duplicate predictions | 0 | 0 | 0 |
| Page errors | 0 | 0 | 0 |

¹ Line 6 (and its replay, line 8): the ASR heard "Эмчид үзүүллээ"; after 3 attempts the model signed ОЙЛГОЛОО · ХҮЛЭЭХ and showed "Эмчид үзүүллээ" as text-only. The meaning was not dropped, but ЭМЧ was not signed.

- Unsigned words ("Хаана нь", "Эрүүл болоорой", the line-6 fragment) were shown in the text-only box in 9/9 staff lines that had them.
- No wrong sign was shown as certain, against 1 in the 11-02 afternoon runs. Retries rose from 7 to 8 of 15.

**Latency, staff speech → avatar** (12 spoken lines; p95 by linear interpolation over n = 12):

| Stage | Median | p95 | Max |
|---|---|---|---|
| ASR (end of speech → final text, incl. 0.7 s end-of-utterance silence) | 0.64 s | 1.29 s | 1.94 s |
| Muse Spark gloss generation (all attempts) | 2.04 s | 7.30 s | 8.37 s |
| Gloss validation (rule checks + Muse Spark meaning check) | 2.08 s | 8.07 s | 10.46 s |
| Server total (generation + validation + playable-sign gate) | 4.15 s | 15.19 s | 18.83 s |
| Avatar clip load → first frame | 0.07 s | 0.12 s | 0.13 s |
| **Speech → avatar starts** | **5.28 s** | **15.94 s** | **19.49 s** |
| Patient sign → provisional sentence | 1.82 s | 3.82 s | 4.07 s |

- The tail comes entirely from line 6, which needed 2–3 model attempts because of the ASR verb error (11.7–19.5 s).
- Lines passed on the first attempt (9 of 12) took 3.2–8.3 s, median 4.1 s.

**Remaining limitations**
- **Retries on the patient side (8/15).** Most are correct signs at 0.45–0.58 (МИНИЙ, УУЧЛААРАЙ, САЙН_БАЙНА_УУ). The gate makes them retries instead of errors; only more webcam training data from the demo signer will reduce them.
- **Line 6.** The ASR verb form causes model retries, a 12–19 s wait, and in 1 of 3 runs no ЭМЧ sign. Rewording the line for the video (for example "Ойлголоо. Эмч таныг үзнэ. Түр хүлээнэ үү.") or retakes would avoid it.
- **Live webcam.** The signer must stand at the training distance (waist up). The duplicate-prediction fix is still unconfirmed on a live session at the right distance.
- **Thresholds.** The gate thresholds and the distance range were set from these same rehearsals and the training clips; they are not validated on new signers.

## End-to-end test setup

- **Staff turns:** the user's recorded staff lines (`line01–04`, laptop mic) are fed in real time into the page's own ASR WebSocket session (100 ms chunks, silence in between, like an open mic). Only the microphone capture is replaced. That capture was tested separately with Chrome's fake audio device: 2/2 lines correct, ASR 0.57–0.66 s.
- **Patient turns:** a webcam rehearsal **not used in training** (`webcam_demo3`, each patient line signed 3 times) was cut into three runs, one repetition of each line per run (hodood had 3 separable repetitions). Each run is a video with a 24 s rest after each line, played into the recognizer in real time. Recordings stay local; the cut test videos were temporary.
- **Turn order:** patient line → (message final) → staff line → … as in the script; line 8 is the avatar replaying line 6.

## Results: three consecutive runs

| Run | Completed | Staff lines: signs correct | Patient lines: labels correct | Patient lines: sentence shown |
|---|---|---|---|---|
| 1 | yes | 5/5 | 5/5 | 5/5 |
| 2 | yes | 5/5 | 3/5 | 5/5 (2 wrong, see below) |
| 3 | yes | 5/5 | 4/5 | 3/5 (2 flagged "unclear, please repeat") |

No page errors in any run. All 15 staff sentences (12 spoken + 3 replays) produced exactly the expected signs, every result passed the checks, and no unsupported sign was ever played.

### Latency per stage (all three runs)

| Stage | Median (max) | n |
|---|---|---|
| ASR: end of speech → final text (incl. 0.7 s end-of-utterance silence) | 0.63 s (1.98) | 12 |
| LLM: glossmap + checks (Muse Spark Open, effort minimal) | 4.82 s (12.19) | 12 |
| Avatar: clip load → first frame | 0.11 s (0.24) | 15 |
| Avatar: whole sequence back to rest | 4.56 s (8.67) | 15 |
| **Staff total: end of speech → avatar starts signing** | **5.53 s (12.95)** | 12 |
| Recognition: classify a finished sign (after 0.35 s hands-down) | 0.01 s (0.66) | 28 |
| **Patient: sign → provisional sentence on screen** | **1.69 s (3.58)** | 21 |

## Remaining failure cases

1. **Confident misrecognition (patient side).** Run 2: ХҮҮХЭД read as СОНСГОЛГҮЙ (0.91) → "Миний сонсголгүй хүүхэд өвдөж байна."; УУЧЛААРАЙ read as БАЯРЛАЛАА (0.78) → "Баярлалаа, дахин хэлнэ үү." Both are plausible sentences, so neither check can catch them. The staff sees the per-sign chips with confidence, but the sentence is wrong. Same two confusions as in the original rehearsal log.
2. **Low confidence → "please repeat".** Run 3: line 1 (0.41/0.47) and line 5 (0.45) gave no sentence, only "unclear" chips; line 7 dropped УУЧЛААРАЙ (0.47) and showed "Дахин хэлнэ үү." with a warning. This is the intended safe behaviour, but it fails the line. The 0.5 threshold was chosen on this same rehearsal (correct signs scored 0.54–1.0, the two errors 0.73–0.91), so it is not independently validated.
3. **ASR word error.** "Эмчид үзүүлье" is heard as "үзүүллээ"/"үзүүл" in every run (also with a vocabulary hint, which was reverted). Signs are unaffected (ЭМЧ is chosen); the unsigned fragment shown as text has the wrong verb form.
4. **Slow LLM on the longest line.** Line 6 took 6.0–12.2 s. Other lines took 2.4–5.9 s.
5. **Turn segmentation.** A patient message ends after 5 s with hands down or when the staff answers. In the rehearsal, signs within one line were ~3.5 s apart (hands down after every sign), so a shorter timeout splits lines. The provisional sentence hides most of this wait.
6. **Signing pace.** The avatar takes 4.6 s median per staff line (up to 8.7 s for three signs). Not a defect; it sets the video's pacing.

## Demo-ready

- Staff speech → avatar for all 5 scripted staff lines, plus replay, with on-screen text for unsigned parts ("Хаана", "Эрүүл болоорой").
- Patient signs → staff text for all 5 patient lines when the recognizer is confident (run 1: 5/5).
- On-screen labels for the video: "Muse Spark Open (open weights) on Baseten", "ASR: Speechmatics (mn)", "Recognizer v8", and in the video "Staff speech: pre-recorded audio · Live AI processing".
- Safe behaviour on screen: uncertain signs in amber with "please repeat", unsupported signs struck through and never played, model failure → text only.

## Remaining limitations (11-03)

- Tested with one signer, the developer, who also recorded the training data. Other signers, distances and lighting are not validated.
- The patient must sit at the trained distance (the page warns when too close or too far) and lower the hands after every sign.
- The closed 9-sign patient vocabulary and the 17 avatar signs cover the demo dialogue, not open conversation.

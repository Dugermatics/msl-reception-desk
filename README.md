# MSL Reception Desk

A two-way communication assistant between a Deaf person who uses **Mongolian Sign Language (MSL)** and a hearing staff member at a public service desk. The demo scenario is a hospital reception desk.

- **Staff → patient:** the staff member speaks Mongolian. A Meta model (**Muse Spark Open**, open weights, served on Baseten) turns the sentence into a sequence of known MSL signs. Mandatory checks run before anything is signed, and then a 3D avatar signs it.
- **Patient → staff:** the patient signs to a webcam. A local recognizer outputs sign labels, and Muse Spark turns them into one short Mongolian sentence (with an English line) on the staff screen.

Built by Dugermatics LLC for the **Meta Global AI Developer Hackathon 2026** (Startup Track, theme "Build for your world").

> **Scope: communication access only.** The system never diagnoses, triages or gives medical advice. It only relays what the two people say. The avatar signs only what the staff member said, and the patient's text contains only what was signed.

## What is pre-existing and what was built during the hackathon

- **Pre-existing, proprietary, not in this repo:**
  - the MSL sign recognizer and the 3D signing avatar
  - their dataset and trained models
  - copyright No. 18261, licensed to Dugermatics LLC

  The demo uses them only to show the output of the new work.
- **Built during the hackathon (Oct 27 – Nov 4, 2026), this repo:**
  - the speech → sign relay with Meta models (`glossmap.py`) and its verification layer (`verification/`)
  - the sign → text relay (`sign2text.py`)
  - the two-way demo app (`app/`)
  - the Muse Voice Transcribe test on Mongolian (`asr/`)
  - the reasoning-effort sweep (`eval_effort.py`)
  - the evaluations, end-to-end tests and results (`eval_demo.py`, `tests/`, `results/`)
- **Built during the hackathon in the private prototype** (described in [REPORT.md](REPORT.md), code not published):
  - a live camera → sign server
  - 5 new avatar signs for the demo (яасан бэ, өвдөх, эмч, хүлээх, ойлголоо)
  - avatar retargeting fixes (fingers, hand orientation, forehead contact)
  - new recognizer training with webcam and seated recordings
- **Planning before the kickoff:** the first draft of `docs/demo_script.md` (the dialogue) was written on 2026-10-26, before the kickoff. No code was written before the kickoff. This repository is a clean snapshot of the hackathon layer; it was developed in a private repository and published here without that history, because the history also contained proprietary code.

## Meta models used

| Where | Model | Why |
|---|---|---|
| Staff text → signs (`glossmap.py`) | **Muse Spark Open** `meta-models/muse-spark-open-1026` on Baseten (default); Muse Spark 1.3 via the Meta Model API (`GLOSSMAP_BACKEND=meta`) | Maps a sentence to known sign ids, plus the words that must stay text |
| Meaning check (`verification/verify_meaning.py`) | same backend, as a judge | Rejects anything added (advice, diagnosis) or left out |
| Patient signs → sentence (`sign2text.py`) | same backend (Muse Spark Open by default) | One short sentence from the recognized signs, then a deterministic check against what was signed |
| Speech → text test (`asr/asr_test.py`) | Muse Voice Transcribe 1.0 | Tested on 16 recorded staff lines. Mongolian is not a validated language: mean CER 48%, so the live demo uses Speechmatics (mn) for ASR, with a mean CER of 1% on the same lines. |

**Reasoning effort.** Muse Spark has 6 effort levels, and `eval_effort.py` sweeps all 6 on the demo evaluation. All levels scored the same, while higher effort was 2–6× slower. The default is therefore `minimal` (median ≈3 s per line). See `results/effort_*.json`.

## Verified signing (`glossmap.py` + `verification/`)

Every model result goes through mandatory checks inside the tool before the avatar signs it:

1. `verify_signs.py`: deterministic rules. The result must have the right JSON shape and use only vocabulary signs. On-screen text may come only from the staff member's own words.
2. `verify_meaning.py`: a Muse Spark judge. Nothing may be added and nothing the patient needs may be left out. The bar is 100%. If the judge's reply can't be read, the result fails, because the fallback is safe.
3. A refused result goes back to the model with the problems, up to 3 times. After that the avatar signs nothing and the staff member's words are shown as text.

`python eval_demo.py` covers 16 cases: the 6 demo lines plus 10 harder ones (rephrasings, sentences with no sign, negation, yes/no questions). The current result is 16/16 on the first attempt.

## Two-way demo app (`app/`)

```
staff speech ─ mic ─▶ Speechmatics real-time (mn) ─▶ text ─▶ Muse Spark Open: glossmap + checks ─▶ playable-sign gate ─▶ avatar
patient signs ─ webcam ─▶ recognizer (local) ─▶ sign labels ─▶ confidence gate ─▶ Muse Spark: sign2text + check ─▶ staff screen
```

- **Staff → patient.** The server relays the microphone to the ASR, so the key never reaches the browser.
  - Only sign ids that are in the vocabulary **and** have verified avatar clips are played.
  - Anything else is shown in a "Text only — not signed" box. It is never replaced by another sign.
- **Patient → staff.** The recognizer labels every sign `committed`, `uncertain` (with a reason: low confidence, hands not visible, out of frame, too close or too far) or `suppressed` (a held gesture repeated).
  - Uncertain signs block the sentence and show "please repeat". They are never sent to the model.
- **Failures.** If the ASR is down, the page says so and switches to the fallback. If a model call fails, the staff member's words are shown as text. If the recognizer is offline, the badge turns red.
- **Privacy.** Nothing from the camera or the microphone is stored. Only text is sent to the model APIs, and the recognizer runs locally.

### Run

The app needs the private recognizer and avatar to show signs, so outside Dugermatics it runs the text paths only.

```
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python.exe -m app.server          # http://127.0.0.1:8780
```

`.env` holds:
- `BASETEN_API_KEY`, or `META_API_KEY` together with `GLOSSMAP_BACKEND=meta`
- `SPEECHMATICS_API_KEY`
- `PRIVATE_ROOT`, the path to the private prototype
- optional `STAFF_AUDIO_DIR`, a folder with recorded staff lines `line01..line04.wav`. It enables the video demo player at `/?staffplay=1`: keys 1–4 play a recorded line through the speakers and stream the same audio into the live ASR, so transcription, sign mapping, checks and the avatar all run live. The page shows "Staff speech: pre-recorded audio · Live AI processing". The recordings are not part of this repo.

Tests:
- `python -m pytest tests` runs the rule checks offline.
- `node tests/e2e/states.js` checks the page states (17/17).
- `node tests/e2e/conversation.js` plays the whole demo dialogue through the real page with real model calls: recorded staff audio, and a recorded patient rehearsal that was not used in training. Results and latency are in [REPORT.md](REPORT.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The MSL recognizer, the avatar, the dataset and the trained models are not covered by this license and are not distributed here.

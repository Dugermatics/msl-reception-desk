"""Speech -> text -> signs test with Muse Voice Transcribe on Mongolian.

For each recorded staff line: transcribe it with Meta's ASR, score the
transcript against the sentence that was read (character error rate), then
run glossmap on the transcript and score the signs as eval_demo does.
Mongolian is not one of the model's validated languages, so this measures
whether it is usable for the demo.

Usage: python asr/asr_test.py [--engine meta|speechmatics] [audio_dir]
       -> results/asr_<engine>.json

speechmatics: batch API, "mn" enhanced, for comparison (the key is read from
the repo's .env, or the file named by SPEECHMATICS_ENV).
"""
import json
import os
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import glossmap  # noqa: E402  (loads .env)
from eval_demo import CASES  # noqa: E402

URL = "https://api.meta.ai/v1/asr/transcribe"
MODEL = "muse-voice-transcribe-1.0"  # meta engine
args = sys.argv[1:]
ENGINE = "meta"
if args[:1] == ["--engine"]:
    ENGINE, args = args[1], args[2:]
AUDIO = Path(args[0] if args else "staff_audio")
SM_URL = "https://asr.api.speechmatics.com/v2"


def transcribe_meta(path):
    req = {"model": MODEL, "audioEncoding": "WAV", "languageBias": ["mongolian"]}
    r = requests.post(URL, headers={"Authorization": f"Bearer {os.environ['META_API_KEY']}"},
                      files={"request": (None, json.dumps(req), "application/json"),
                             "audio": (path.name, path.read_bytes(), "audio/wav")}, timeout=120)
    r.raise_for_status()
    return r.json().get("transcript", "")


def transcribe_speechmatics(path):
    h = {"Authorization": f"Bearer {os.environ['SPEECHMATICS_API_KEY']}"}
    cfg = {"type": "transcription", "transcription_config": {"language": "mn", "operating_point": "enhanced"}}
    r = requests.post(f"{SM_URL}/jobs", headers=h, timeout=60,
                      files={"data_file": (path.name, path.read_bytes(), "audio/wav"),
                             "config": (None, json.dumps(cfg), "application/json")})
    r.raise_for_status()
    job = r.json()["id"]
    while True:
        time.sleep(3)
        st = requests.get(f"{SM_URL}/jobs/{job}", headers=h, timeout=30).json()["job"]["status"]
        if st == "done":
            break
        if st == "rejected":
            raise RuntimeError(f"job {job} rejected")
    r = requests.get(f"{SM_URL}/jobs/{job}/transcript", headers=h, params={"format": "txt"}, timeout=30)
    r.raise_for_status()
    return r.content.decode("utf-8").strip()  # no charset header: decode bytes ourselves


def timed(fn, path):
    t = time.time()
    return fn(path), time.time() - t


def norm(s):
    s = unicodedata.normalize("NFC", s).lower()
    return " ".join("".join(c if c.isalnum() or c.isspace() else " " for c in s).split())


def cer(ref, hyp):
    a, b = norm(ref), norm(hyp)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / max(len(a), 1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if ENGINE == "speechmatics":
        from dotenv import load_dotenv
        if os.environ.get("SPEECHMATICS_ENV"):
            load_dotenv(os.environ["SPEECHMATICS_ENV"])
    fn = {"meta": transcribe_meta, "speechmatics": transcribe_speechmatics}[ENGINE]
    name = MODEL if ENGINE == "meta" else "speechmatics-mn-enhanced"
    vocab = glossmap.load_vocab()
    paths = {i: AUDIO / f"line{i:02d}.wav" for i in range(1, len(CASES) + 1)}
    paths = {i: p for i, p in paths.items() if p.exists()}
    with ThreadPoolExecutor(8) as pool:  # transcribe all first, in parallel
        heard = dict(zip(paths, pool.map(lambda p: timed(fn, p), paths.values())))
    rows = []
    for i, (sentence, expected, optional, need_text) in enumerate(CASES, 1):
        if i not in heard:
            continue
        hyp, asr_secs = heard[i]
        c = cer(sentence, hyp)
        r = glossmap.to_signs(hyp, vocab) if hyp.strip() else {"signs": [], "text": [], "verified": False, "attempts": 0}
        signs = set(r["signs"])
        ok = r["verified"] and expected <= signs and not (signs - expected - optional)
        rows.append({"line": i, "said": sentence, "heard": hyp, "cer": round(c, 3), "asr_secs": round(asr_secs, 1),
                     "signs": r["signs"], "text": r["text"], "signs_ok": ok})
        print(f"{i:2d} CER {c:4.0%} {'OK ' if ok else 'BAD'} {asr_secs:4.1f}s\n   said:  {sentence}\n   heard: {hyp}\n"
              f"   signs: {r['signs']} text: {r['text']}", flush=True)
    if rows:
        n = len(rows)
        mean = sum(x["cer"] for x in rows) / n
        good = sum(x["signs_ok"] for x in rows)
        print(f"\n[{name}] lines {n} | mean CER {mean:.0%} | signs correct from transcript {good}/{n}")
        out = ROOT / "results" / f"asr_{ENGINE}.json"
        out.write_text(json.dumps({"model": name, "glossmap": glossmap.MODEL, "rows": rows},
                                  ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {out}")
    else:
        print(f"no recordings in {AUDIO}")

"""Two-way reception-desk demo server (localhost only).

    staff speech --Speechmatics RT--> Mongolian text --Muse Spark (glossmap)--> checked sign ids --> avatar
    patient signs --recognizer (separate process, :8770)--> sign labels --Muse Spark (sign2text)--> staff text

Run (from the repo root):
    .venv/Scripts/python.exe -m app.server            # http://127.0.0.1:8780

Environment:
    PRIVATE_ROOT       the private avatar prototype (not in this repo). Only its
                       frontend/ and the landmark clips the avatar plays are served, to localhost.
    SPEECHMATICS_ENV   optional extra .env file holding SPEECHMATICS_API_KEY (default: the repo's .env)
    GLOSSMAP_BACKEND   open (Muse Spark Open on Baseten, default) | meta (Muse Spark, Meta Model API)
    RECOGNIZER_URL     default http://127.0.0.1:8770

Nothing from the camera or the microphone is stored. The session log
(logs/*.jsonl, git-ignored) holds only text results and timings.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from aiohttp import WSMsgType, web
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
if os.environ.get("SPEECHMATICS_ENV"):
    load_dotenv(os.environ["SPEECHMATICS_ENV"])

import glossmap  # noqa: E402
import sign2text  # noqa: E402
from app.asr_speechmatics import RTSession  # noqa: E402

PRIVATE_ROOT = Path(os.environ.get("PRIVATE_ROOT", "../msl-private"))
RECOGNIZER_URL = os.environ.get("RECOGNIZER_URL", "http://127.0.0.1:8770")
STATIC = Path(__file__).resolve().parent / "static"
LOG_DIR = ROOT / "logs"
VOCAB = glossmap.load_vocab(include_planned=False)
RECOG_VOCAB = sign2text.load_vocab()
MODEL_LABEL = {"open": "Muse Spark Open (open weights) on Baseten", "meta": "Muse Spark 1.3, Meta Model API"}[glossmap.BACKEND]


def playable_signs():
    """Sign ids the avatar may play: in the vocabulary AND with verified clips in clip_allowlist.json."""
    try:
        allow = json.loads((PRIVATE_ROOT / "frontend" / "clip_allowlist.json").read_text(encoding="utf-8"))["clips"]
    except (OSError, ValueError, KeyError):
        allow = {}
    return {s["id"] for s in VOCAB if allow.get(s["id"])}


PLAYABLE = playable_signs()


def log(event: dict):
    LOG_DIR.mkdir(exist_ok=True)
    event = {"ts": datetime.now().isoformat(timespec="milliseconds"), **event}
    with open(LOG_DIR / f"session_{datetime.now():%Y%m%d}.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def gloss(sentence: str) -> dict:
    """glossmap + the playable-sign gate. Unknown or unverified ids are reported, never played or replaced."""
    t0 = time.time()
    try:
        r = glossmap.to_signs(sentence, VOCAB)
    except Exception as e:  # API down / timeout: show the staff's words, sign nothing
        return {"sentence": sentence, "signs": [], "rejected": [], "text": [sentence], "verified": False,
                "attempts": 0, "llm_ms": int((time.time() - t0) * 1000), "error": f"model call failed: {type(e).__name__}"}
    signs = [s for s in r["signs"] if s in PLAYABLE]
    rejected = [s for s in r["signs"] if s not in PLAYABLE]
    text = list(r["text"])
    if rejected and sentence not in text:  # meaning would be lost: show the whole sentence too
        text.append(sentence)
    return {"sentence": sentence, "signs": signs, "rejected": rejected, "text": text,
            "verified": r["verified"], "attempts": r["attempts"], "llm_ms": int((time.time() - t0) * 1000),
            "model_ms": r.get("model_ms"), "check_ms": r.get("check_ms")}


TRANSLATE_PROMPT = """Translate the user's Mongolian text into English for an English-speaking viewer of a
hospital reception-desk demo. Translate literally and briefly. Do not add, explain, soften or complete
anything; keep questions as questions. Note: "эмчид үзүүлэх" means to be examined by a doctor
("Эмчид үзүүлье" = "Let's have a doctor see you"). Reply with JSON only: {"en": "<English>"}"""
_translations: dict[str, str] = {}


def translate(text: str) -> dict:
    """Mongolian -> English subtitle for judges. Only called for confirmed text (never for uncertain results)."""
    text = (text or "").strip()
    if not text:
        return {"en": "", "llm_ms": 0}
    if text in _translations:
        return {"en": _translations[text], "llm_ms": 0, "cached": True}
    t0 = time.time()
    try:
        out = json.loads(glossmap.complete([{"role": "system", "content": TRANSLATE_PROMPT},
                                            {"role": "user", "content": text}]))
        en = str(out.get("en", "")).strip()
    except Exception as e:  # no subtitle is better than a wrong one
        return {"en": "", "llm_ms": int((time.time() - t0) * 1000), "error": type(e).__name__}
    _translations[text] = en
    return {"en": en, "llm_ms": int((time.time() - t0) * 1000)}


async def api_translate(req):
    body = await req.json()
    r = await asyncio.get_running_loop().run_in_executor(None, translate, body.get("text", ""))
    log({"kind": "translate", "dir": body.get("dir"), "text": body.get("text"), **r})
    return web.json_response(r)


async def api_config(_req):
    return web.json_response({
        "model": MODEL_LABEL, "playable": sorted(PLAYABLE), "recognizer_url": RECOGNIZER_URL,
        "recognizer_signs": [{"id": s["id"], "mn": s["mn"], "en": s["en"]} for s in RECOG_VOCAB["signs"]],
        "avatar_signs": [{"id": s["id"], "mn": s["mn"], "en": s.get("en", "")} for s in VOCAB],
        "asr": "speechmatics" if os.environ.get("SPEECHMATICS_API_KEY") else None,
        "conf_min": sign2text.CONF_MIN,
    })


async def api_gloss(req):
    body = await req.json()
    sentence = (body.get("text") or "").strip()
    if not sentence:
        return web.json_response({"error": "empty"}, status=400)
    r = await asyncio.get_running_loop().run_in_executor(None, gloss, sentence)
    log({"kind": "gloss", "source": body.get("source", "typed"), **r})
    return web.json_response(r)


async def api_sign2text(req):
    body = await req.json()
    signs = body.get("signs") or []
    r = await asyncio.get_running_loop().run_in_executor(None, sign2text.to_text, signs)
    log({"kind": "sign2text", "input": signs, **r})
    return web.json_response(r)


async def api_log(req):
    log({"kind": "client", **(await req.json())})
    return web.json_response({"ok": True})


async def api_asr(req):
    """Browser mic (16 kHz s16le PCM, binary frames) -> Speechmatics RT -> transcripts, then glossmap per utterance."""
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(req)
    loop = asyncio.get_running_loop()
    chunks = []          # (audio seconds sent so far, wall time) for latency
    sent = [0.0]
    last_word_end = [0.0]

    def wall_at(audio_t):
        for a, w in chunks:
            if a >= audio_t:
                return w
        return chunks[-1][1] if chunks else time.time()

    async def send(m):
        if not ws.closed:
            await ws.send_str(json.dumps(m, ensure_ascii=False))

    async def on_asr(m):
        if m["type"] == "final" and m.get("end_time"):
            last_word_end[0] = m["end_time"]
        if m["type"] == "utterance_end":
            speech_end = wall_at(last_word_end[0])
            m["asr_ms"] = int((m["t"] - speech_end) * 1000)
            await send(m)

            async def relay(text=m["text"], asr_ms=m["asr_ms"]):  # don't block the ASR reader
                r = await loop.run_in_executor(None, gloss, text)
                r["asr_ms"] = asr_ms
                log({"kind": "gloss", "source": "speechmatics", **r})
                await send({"type": "gloss", **r})
            asyncio.create_task(relay())
            return
        await send(m)

    session = RTSession(on_asr)
    try:
        await session.open()
    except Exception as e:
        await send({"type": "error", "text": f"ASR unavailable: {e}"})
        await ws.close()
        return ws
    await send({"type": "ready"})
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                sent[0] += len(msg.data) / 2 / 16000
                chunks.append((sent[0], time.time()))
                if len(chunks) > 3000:
                    del chunks[:1000]
                await session.send_audio(msg.data)
            elif msg.type == WSMsgType.TEXT and msg.data == "stop":
                break
            if session.closed.is_set():
                await send({"type": "error", "text": "ASR connection closed"})
                break
    finally:
        await session.finish(timeout=5)
        if not ws.closed:
            await ws.close()
    return ws


async def index(_req):
    return web.FileResponse(STATIC / "index.html")


def make_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/config", api_config)
    app.router.add_post("/api/gloss", api_gloss)
    app.router.add_post("/api/sign2text", api_sign2text)
    app.router.add_post("/api/log", api_log)
    app.router.add_post("/api/translate", api_translate)
    app.router.add_get("/api/asr", api_asr)
    app.router.add_static("/static/", STATIC)
    # The private avatar (served to localhost only, never copied into this repo):
    app.router.add_static("/p/frontend/", PRIVATE_ROOT / "frontend")
    app.router.add_static("/p/backend/dataset/processed_json/", PRIVATE_ROOT / "backend" / "dataset" / "processed_json")
    return app


if __name__ == "__main__":
    port = int(os.environ.get("DEMO_PORT", "8780"))
    print(f"Demo on http://127.0.0.1:{port}  ({MODEL_LABEL}; playable signs {len(PLAYABLE)})", flush=True)
    web.run_app(make_app(), host="127.0.0.1", port=port, print=None)

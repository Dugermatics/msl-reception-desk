"""Staff speech text -> sequence of known MSL signs, via Muse Spark.

The model only picks from the sign vocabulary. Anything it can't express
with a known sign comes back as plain text for the screen; it never invents
signs and never adds content the staff member didn't say.

Usage: python glossmap.py "Ойлголоо. Эмчийг түр хүлээнэ үү."

Backend is picked with GLOSSMAP_BACKEND: "open" (open-weights Muse Spark Open
hosted on Baseten, default) or "meta" (Muse Spark via Meta Model API).
"""
import json
import time
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from verification import verify_meaning, verify_signs

ROOT = Path(__file__).parent
MAX_ATTEMPTS = 3

BACKENDS = {
    "meta": {
        "base_url": "https://api.meta.ai/v1",
        "key_env": "META_API_KEY",
        "model": "muse-spark-1.3",
    },
    "open": {
        "base_url": "https://inference.baseten.co/v1",
        "key_env": "BASETEN_API_KEY",
        "model": "meta-models/muse-spark-open-1026",
    },
}

load_dotenv(ROOT / ".env")
BACKEND = os.environ.get("GLOSSMAP_BACKEND", "open")
_cfg = BACKENDS[BACKEND]
MODEL = _cfg["model"]
client = OpenAI(base_url=_cfg["base_url"], api_key=os.environ[_cfg["key_env"]])
# Reasoning effort (minimal/low/medium/high/xhigh/max). Picked from eval_effort.py
# (results/effort_*.json): every level scored the same, minimal was 2-6x faster.
EFFORT = os.environ.get("GLOSSMAP_EFFORT", "minimal")
USAGE = {"calls": 0, "completion_tokens": 0, "reasoning_tokens": 0}


def complete(messages):
    """One JSON-mode call with the configured model and effort; tallies token use."""
    extra = {"reasoning_effort": EFFORT} if EFFORT else {}
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0,
        # Muse Spark always reasons first; reasoning tokens count against
        # this limit, so leave plenty of room or the JSON gets cut off.
        max_tokens=4096,
        **extra,
    )
    USAGE["calls"] += 1
    if resp.usage:
        USAGE["completion_tokens"] += resp.usage.completion_tokens or 0
        details = getattr(resp.usage, "completion_tokens_details", None)
        USAGE["reasoning_tokens"] += getattr(details, "reasoning_tokens", 0) or 0
    return resp.choices[0].message.content


def load_vocab(include_planned=True):
    signs = json.loads((ROOT / "signs" / "vocab.json").read_text(encoding="utf-8"))["signs"]
    return [s for s in signs if include_planned or s["status"] == "ready"]


def system_prompt(vocab):
    lines = "\n".join(f"- {s['id']}: {s['mn']} ({s['en']})" for s in vocab)
    return f"""You relay what a hospital reception staff member says to a Deaf patient in Mongolian Sign Language.
You convert the staff member's Mongolian sentence into a sequence of signs from the vocabulary below.

Rules:
- Use ONLY sign ids from the vocabulary. Never invent an id.
- Express the meaning, not the words: different phrasings of the same meaning map to the same sign
  (e.g. "Юу болсон бэ?", "Танд юу тохиолдов?", "Яасан бэ?" all -> yasan_be).
- Drop words that sign language leaves out (particles, case endings, politeness fillers).
- If an important part of the meaning has no sign, put that part, in Mongolian, in "text".
  Do not approximate it with an unrelated sign.
- Questions: signs alone can turn a question into a statement ("Та жирэмсэн үү?" signed as just
  jiremsen reads "pregnant"). If the sentence asks something and no sign you chose is itself a
  question (like yasan_be), sign its content as usual AND put the question, in Mongolian, in "text".
- Relay only what was said. Never add advice, diagnosis, or anything the staff member did not say.

Vocabulary:
{lines}

Reply with JSON only: {{"signs": ["<id>", ...], "text": ["<unsigned Mongolian fragment>", ...]}}"""


def check(sentence, out, vocab):
    """The mandatory checks, cheapest first; the model can't skip them."""
    result = verify_signs.run_verification(sentence, out, vocab)
    if result["passed"]:
        result = verify_meaning.run_verification(complete, sentence, out, vocab)
    return result


def to_signs(sentence, vocab=None):
    """{"signs", "text", "verified", "attempts", "feedback"}.

    A refused result goes back to the model with the problems, up to
    MAX_ATTEMPTS. If it still fails, the avatar signs nothing and the staff
    member's own words are shown as text: the patient never sees an
    unchecked relay.
    """
    vocab = vocab or load_vocab()
    messages = [
        {"role": "system", "content": system_prompt(vocab)},
        {"role": "user", "content": sentence},
    ]
    feedback = []
    model_ms = check_ms = 0   # Muse Spark generation vs the checks (verify_meaning makes its own model call)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        t0 = time.perf_counter()
        reply = complete(messages)
        t1 = time.perf_counter()
        model_ms += int((t1 - t0) * 1000)
        try:
            out = json.loads(reply)
            result = check(sentence, out, vocab)
        except (ValueError, TypeError):
            result = {"passed": False, "feedback": ["reply is not valid JSON"]}
        check_ms += int((time.perf_counter() - t1) * 1000)
        if result["passed"]:
            return {"signs": out["signs"], "text": out["text"], "verified": True,
                    "attempts": attempt, "feedback": feedback, "model_ms": model_ms, "check_ms": check_ms}
        feedback = result["feedback"]
        messages += [
            {"role": "assistant", "content": reply},
            {"role": "user", "content": "Refused by the checks:\n- " + "\n- ".join(feedback)
                                        + "\nFix these and reply with the JSON again."},
        ]
    return {"signs": [], "text": [sentence], "verified": False,
            "attempts": MAX_ATTEMPTS, "feedback": feedback, "model_ms": model_ms, "check_ms": check_ms}


if __name__ == "__main__":
    print(json.dumps(to_signs(" ".join(sys.argv[1:])), ensure_ascii=False))

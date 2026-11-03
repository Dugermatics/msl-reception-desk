"""Recognized patient signs -> one short Mongolian sentence for the staff screen, via Muse Spark.

The model may only add grammar (case endings, particles, "байна", "би");
every content word must come from the signs that were recognized. A
deterministic check enforces that; a refused sentence goes back once with the
problems, and if it still fails the staff sees the plain sign glosses instead.
Low-confidence signs are never sent to the model: they are shown to the staff
as uncertain, so nothing the patient may not have signed reaches the sentence.

Usage: python sign2text.py minii_manai huuhed uvduh
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import glossmap  # shares the backend (Muse Spark Open on Baseten by default) and .env
from verification.verify_signs import said, words

ROOT = Path(__file__).parent
CONF_MIN = 0.5     # below this a recognized sign is shown as uncertain and left out (held-out rehearsal: correct signs scored 0.54-1.0)
MAX_ATTEMPTS = 2


def load_vocab():
    return json.loads((ROOT / "signs" / "recognizer_vocab.json").read_text(encoding="utf-8"))


def gloss_text(ids, vocab):
    by_id = {s["id"]: s for s in vocab["signs"]}
    return ", ".join(by_id[i]["mn"].split(" (")[0].capitalize() if n == 0 else by_id[i]["mn"].split(" (")[0]
                     for n, i in enumerate(ids)) + "."


def system_prompt(vocab):
    lines = "\n".join(f"- {s['id']}: {s['mn']} ({s['en']})" for s in vocab["signs"])
    return f"""A Deaf patient at a hospital reception signed a short message in Mongolian Sign Language.
A recognizer turned it into the sign sequence the user gives you. Write it as ONE short, natural Mongolian
sentence (or two very short ones) for the reception staff to read.

Rules:
- Use the meaning of every given sign, in order. Do not drop any.
- Add only grammar: case endings, particles, the verb "байна", the pronoun "би". Sign language leaves these out.
- Never add content that is not in the signs: no new symptoms, body parts, places, times, people,
  intensity ("маш", "их"), or requests. If it is unclear, keep it literal.
- A lone noun sign is an answer: write just the word ("hodood" -> "Ходоод."), no "байна".
- Do not answer, advise, or interpret medically. You only write down what was signed.

Sign meanings:
{lines}

Reply with JSON only: {{"text": "<Mongolian sentence>", "used": ["<id>", ...]}}"""


def check(ids, out, vocab):
    """Deterministic: all signs used, and no content word that is not from them."""
    text, used = out.get("text"), out.get("used")
    if not isinstance(text, str) or not text.strip():
        return ['"text" must be a non-empty string']
    if not isinstance(used, list) or sorted(used) != sorted(ids):
        return [f'"used" must list exactly these signs: {ids}']
    by_id = {s["id"]: s for s in vocab["signs"]}
    allowed = list(vocab["function_words"])
    for i in ids:
        allowed += by_id[i]["words"] + words(by_id[i]["mn"])
    allowed = [w.lower() for w in allowed]
    extra = [w for w in words(text) if not said(w, allowed)]
    return [f'"{", ".join(extra)}" was not signed; use only the signs\' meanings plus grammar'] if extra else []


def to_text(signs, vocab=None):
    """signs = [{"label", "confidence"}, ...] in signing order.

    Returns {"text", "glosses", "uncertain", "verified", "source", "attempts", "llm_ms"}.
    source: "model" (checked sentence), "glosses" (fallback), "none" (nothing certain).
    """
    vocab = vocab or load_vocab()
    known = {s["id"] for s in vocab["signs"]}
    def unsure(s):  # the recognizer's own verdict (temporal consistency, margin, hands visible) or low confidence
        return s.get("uncertain") or s.get("label") not in known or s.get("confidence", 1) < CONF_MIN
    ids = [s["label"] for s in signs if not unsure(s)]
    uncertain = [s for s in signs if unsure(s)]
    base = {"glosses": ids, "uncertain": uncertain, "attempts": 0, "llm_ms": 0}
    if not ids:
        return {**base, "text": "", "verified": False, "source": "none"}
    if uncertain:
        # Never write a fluent sentence around a gap: the missing sign may change the
        # meaning (e.g. a dropped negation). The staff sees the certain glosses and a
        # "please repeat"; the patient re-signs.
        return {**base, "text": "", "verified": False, "source": "uncertain"}

    messages = [{"role": "system", "content": system_prompt(vocab)},
                {"role": "user", "content": json.dumps(ids)}]
    t0 = time.time()
    problems = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        base["attempts"] = attempt
        try:
            reply = glossmap.complete(messages)
            out = json.loads(reply)
            problems = check(ids, out, vocab)
        except (ValueError, TypeError):
            reply, problems = "", ["reply is not valid JSON"]
        except Exception as e:  # API down, timeout: fall back to the glosses
            problems = [f"model call failed: {type(e).__name__}"]
            break
        if not problems:
            base["llm_ms"] = int((time.time() - t0) * 1000)
            return {**base, "text": out["text"].strip(), "verified": True, "source": "model"}
        messages += [{"role": "assistant", "content": reply},
                     {"role": "user", "content": "Refused by the checks:\n- " + "\n- ".join(problems)
                                                 + "\nFix these and reply with the JSON again."}]
    base["llm_ms"] = int((time.time() - t0) * 1000)
    return {**base, "text": gloss_text(ids, vocab), "verified": False, "source": "glosses", "feedback": problems}


if __name__ == "__main__":
    print(json.dumps(to_text([{"label": a, "confidence": 1.0} for a in sys.argv[1:]]), ensure_ascii=False))

"""Muse Spark judge: does the result carry what the staff member said, and only that?

    run_verification(complete, sentence, out, vocab) -> {"passed": bool, "feedback": [problem, ...]}

One model call per result, after verify_signs passes. Hospital setting, so the
bar is 100%: anything added (advice, diagnosis, a meaning the staff member did
not say) fails, and so does a dropped part the patient needs to understand or
act on. A judgement that can't be read fails too; the caller then shows the
staff member's own words as text, which is always safe.
"""

from __future__ import annotations

import json

PROMPT = """A hospital reception staff member said this to a Deaf patient (Mongolian):
"{sentence}"

It will be relayed as these Mongolian Sign Language signs, in order, then this text on screen:
signs: {signs}
text: {text}

Check the relay against what was said.
- "added": anything in the signs or text that the staff member did not say or mean
  (advice, diagnosis, instructions, a different meaning). Rewording the same meaning is fine.
- "missing": any part of what was said that the patient needs to understand or act on and that
  is in neither the signs nor the text. Greetings, politeness and filler words may be dropped.

Answer only with JSON: {{"added": ["one sentence each"], "missing": ["one sentence each"]}}
(empty lists when the relay is faithful)."""


def run_verification(complete, sentence: str, out: dict, vocab: list) -> dict:
    """complete(messages) -> reply text: the caller's JSON-mode model call."""
    meaning = {s["id"]: f"{s['mn']} ({s['en']})" for s in vocab}
    reply = complete([{"role": "user", "content": PROMPT.format(
        sentence=sentence,
        signs=json.dumps([f"{s} = {meaning.get(s, '?')}" for s in out["signs"]], ensure_ascii=False),
        text=json.dumps(out["text"], ensure_ascii=False),
    )}])
    try:
        verdict = json.loads(reply)
        added, missing = verdict.get("added") or [], verdict.get("missing") or []
    except (ValueError, AttributeError, TypeError):
        return {"passed": False, "feedback": ["the meaning check could not be read"]}
    problems = [f"added: {a}" for a in added] + [f"missing: {m}" for m in missing]
    return {"passed": not problems, "feedback": problems}

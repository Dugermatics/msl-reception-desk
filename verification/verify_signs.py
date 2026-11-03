"""Deterministic rules for a glossmap result. No model call.

    run_verification(sentence, out, vocab) -> {"passed": bool, "feedback": [problem, ...]}

out = {"signs": [id, ...], "text": [fragment, ...]}.

Rules (one problem string per break, which the model reads and fixes):
- the reply has the right shape: "signs" and "text" are lists of strings;
- every sign id is in the vocabulary;
- every text fragment comes from the staff sentence: each of its words appears
  there (an inflected form counts). Text the staff member did not say is never
  shown to the patient.
"""

from __future__ import annotations

import re

WORD = re.compile(r"[^\W\d_]+")
STEM = 4  # Mongolian inflects by suffix; a shared start (up to 4 letters) counts as the same word


def words(s: str) -> list[str]:
    return [w.lower() for w in WORD.findall(s)]


def said(word: str, source: list[str]) -> bool:
    return any(word == w or (len(word) >= 3 and w.startswith(word[:STEM])) for w in source)


def run_verification(sentence: str, out: dict, vocab: list) -> dict:
    signs, text = out.get("signs"), out.get("text")
    if not isinstance(signs, list) or not all(isinstance(s, str) for s in signs):
        return {"passed": False, "feedback": ['"signs" must be a list of sign ids']}
    if not isinstance(text, list) or not all(isinstance(t, str) for t in text):
        return {"passed": False, "feedback": ['"text" must be a list of strings']}

    problems = []
    known = {s["id"] for s in vocab}
    problems += [f"{s}: not a sign in the vocabulary; use a listed id or put the meaning in text" for s in signs if s not in known]

    source = words(sentence)
    for t in text:
        extra = [w for w in words(t) if not said(w, source)]
        if extra:
            problems.append(f'text "{t}": {", ".join(extra)} was not said by the staff member; relay only their words')
    return {"passed": not problems, "feedback": problems}

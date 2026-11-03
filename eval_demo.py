"""Ground-truth check: run the staff lines through glossmap and score them.

Expected signs come from docs/demo_script.md, plus rephrasings that must map
to the same sign. Coverage = expected signs found / all expected signs; a line
also fails if it signs something outside its expected set.

Usage: python eval_demo.py   (GLOSSMAP_BACKEND picks the model, as in glossmap)
"""
import json
import time

import glossmap

# (sentence, expected signs, optional signs that don't count as extra, needs on-screen text)
DEMO_CASES = [
    ("Сайн байна уу. Танд юу тохиолдов?", {"sain_baina_uu", "yasan_be"}, set(), False),
    ("Хаана нь өвдөж байна?", {"uvduh"}, set(), False),
    ("Ойлголоо. Эмчийг түр хүлээнэ үү.", {"oilgoloo", "emch", "huleeh"}, set(), False),
    ("Баяртай, эрүүл болоорой.", {"bayartai"}, set(), False),
    ("Юу болсон бэ?", {"yasan_be"}, set(), False),
    ("Яасан бэ?", {"yasan_be"}, set(), False),
]
HARD_CASES = [
    # Rephrasings of known signs
    ("За, ойлгосон. Түр хүлээж байгаарай.", {"oilgoloo", "huleeh"}, set(), False),
    ("Эмч таныг удахгүй үзнэ, жаахан хүлээгээрэй.", {"emch", "huleeh"}, set(), False),
    ("Хүүхэд тань өвдөөд байна уу?", {"huuhed", "uvduh"}, set(), False),
    ("Та жирэмсэн үү?", {"jiremsen"}, set(), False),
    ("Маш их баярлалаа, баяртай.", {"bayarlalaa", "bayartai"}, set(), False),
    # Meaning with no sign: must reach the screen as text, not a stand-in sign
    ("Энэ маягтыг бөглөнө үү.", set(), set(), True),
    ("Хоёрдугаар давхарт гарна уу.", set(), set(), True),
    ("Уучлаарай, эмч одоогоор завгүй байна.", {"uuchlaarai", "emch"}, set(), True),
    # Negation: signing only the bare verb would say the opposite
    ("Хүлээх шаардлагагүй, шууд ороорой.", set(), {"huleeh"}, True),
    ("Эм бүү уугаарай, эмчийг хүлээгээрэй.", {"emch", "huleeh"}, set(), True),
]
CASES = DEMO_CASES + HARD_CASES

def evaluate(vocab=None, verbose=True, cases=None):
    """Run every case once; returns the scores plus per-line latency and attempts.

    A line passes when it has all expected signs, no extra ones, on-screen text
    where a meaning has no sign, and the checks verified it.
    """
    vocab = vocab or glossmap.load_vocab()
    cases = cases or CASES
    found = total = clean = verified = text_ok = passed = 0
    lines = []
    for sentence, expected, optional, need_text in cases:
        t = time.time()
        r = glossmap.to_signs(sentence, vocab)
        secs = time.time() - t
        signs = set(r["signs"])
        extra = signs - expected - optional
        has_text = any(str(x).strip() for x in r["text"])
        # An unverified result falls back to the staff text on screen; that is
        # safe but not a pass.
        line_text_ok = has_text or not need_text
        ok = r["verified"] and expected <= signs and not extra and line_text_ok
        found += len(signs & expected)
        total += len(expected)
        clean += not extra
        verified += r["verified"]
        text_ok += line_text_ok
        passed += ok
        lines.append({"sentence": sentence, "secs": round(secs, 1), "attempts": r["attempts"],
                      "verified": r["verified"], "signs": r["signs"], "text": r["text"],
                      "extra": sorted(extra), "passed": ok})
        if verbose:
            print(f"{secs:5.1f}s  try {r['attempts']}  {'PASS' if ok else 'FAIL'}  {'OK ' if r['verified'] else 'TXT'}  "
                  f"{sentence} -> {json.dumps(r['signs'], ensure_ascii=False)} {json.dumps(r['text'], ensure_ascii=False)}"
                  + (f"  EXTRA {sorted(extra)}" if extra else "")
                  + ("  NO-TEXT" if not line_text_ok else "")
                  + (f"  feedback {r['feedback']}" if r["feedback"] else ""), flush=True)
    n = len(cases)
    return {"found": found, "total": total, "clean": clean, "verified": verified,
            "text_ok": text_ok, "passed": passed, "n": n, "lines": lines}


if __name__ == "__main__":
    s = evaluate()
    print(f"\n[{glossmap.MODEL} effort={glossmap.EFFORT}] passed {s['passed']}/{s['n']} | "
          f"coverage {s['found']}/{s['total']} = {s['found'] / s['total']:.0%} | "
          f"no extra signs {s['clean']}/{s['n']} | text where needed {s['text_ok']}/{s['n']} | "
          f"verified {s['verified']}/{s['n']}")

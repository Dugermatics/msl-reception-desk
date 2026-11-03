"""Reasoning-effort sweep: run the demo eval at each effort level and compare.

More reasoning is not reliably better (it can talk itself out of a right
answer) and it costs time and tokens, so the effort glossmap uses is picked
from these numbers, not assumed.

Usage: python eval_effort.py [--reps N] [--levels minimal,low,medium,high]
(GLOSSMAP_BACKEND picks the model, as in glossmap.) Writes results/effort_<backend>.json.
"""
import argparse
import json
import statistics
import time
from pathlib import Path

import eval_demo
import glossmap

LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=2)
    ap.add_argument("--levels", default=",".join(LEVELS))
    ap.add_argument("--tag", default="", help="suffix for the results file")
    args = ap.parse_args()

    vocab = glossmap.load_vocab()
    rows = []
    for level in args.levels.split(","):
        glossmap.EFFORT = level
        for rep in range(args.reps):
            for k in glossmap.USAGE:
                glossmap.USAGE[k] = 0
            t = time.time()
            try:
                s = eval_demo.evaluate(vocab, verbose=False)
            except Exception as e:  # e.g. a level this backend rejects
                print(f"{level:8} rep {rep + 1}: ERROR {type(e).__name__}: {str(e)[:150]}")
                break
            secs = [l["secs"] for l in s["lines"]]
            row = {"effort": level, "rep": rep + 1,
                   **{k: s[k] for k in ("passed", "found", "total", "clean", "text_ok", "verified", "n")},
                   "retries": sum(l["attempts"] - 1 for l in s["lines"]),
                   "total_secs": round(time.time() - t, 1), "median_line_secs": statistics.median(secs),
                   "max_line_secs": max(secs), **dict(glossmap.USAGE), "lines": s["lines"]}
            rows.append(row)
            print(f"{level:8} rep {rep + 1}: PASSED {s['passed']}/{s['n']}  coverage {s['found']}/{s['total']}  "
                  f"clean {s['clean']}/{s['n']}  text {s['text_ok']}/{s['n']}  "
                  f"verified {s['verified']}/{s['n']}  retries {row['retries']}  "
                  f"median {row['median_line_secs']}s  max {row['max_line_secs']}s  "
                  f"calls {row['calls']}  reasoning tok {row['reasoning_tokens']}", flush=True)

    out = Path(__file__).parent / "results" / f"effort_{glossmap.BACKEND}{args.tag}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"model": glossmap.MODEL, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {out}")

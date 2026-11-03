"""Markdown summary of results/e2e_run*.json (accuracy per turn, latency per stage).

    python tests/e2e/summarize.py [results/e2e_run1.json ...]
"""
import glob
import json
import statistics
import sys

files = sys.argv[1:] or sorted(glob.glob("results/e2e_run*.json"))
runs = [json.load(open(f, encoding="utf-8")) for f in files]


def p95(xs):
    xs = sorted(xs)
    k = 0.95 * (len(xs) - 1)
    lo = int(k)
    return xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (k - lo)


def stat(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    if not xs:
        return "– | – | – | 0"
    return f"{statistics.median(xs) / 1000:.2f} s | {p95(xs) / 1000:.2f} s | {max(xs) / 1000:.2f} s | {len(xs)}"


print("| Run | Completed | Staff lines: signs correct | Patient lines: labels correct | Patient lines: text shown |")
print("|---|---|---|---|---|")
for r in runs:
    pt = [t for t in r["turns"] if t.get("who") == "patient"]
    shown = sum(1 for t in pt if t.get("source") == "model")
    print(f"| {r['run']} | {'yes' if r['completed'] else 'NO'} | {r['staff_lines_correct']}/{r['staff_lines']} "
          f"| {r['patient_lines_correct']}/{r['patient_lines']} | {shown}/{len(pt)} |")

staff = [t for r in runs for t in r["turns"] if t.get("who") == "staff" and not t.get("replay")]
replay = [t for r in runs for t in r["turns"] if t.get("replay")]
patient = [t for r in runs for t in r["turns"] if t.get("who") == "patient"]
print()
print("| Stage | Median | p95 | Max | n |")
print("|---|---|---|---|---|")
print(f"| ASR: end of speech → final text (Speechmatics RT, incl. 0.7 s end-of-utterance silence) | {stat([t['asr_ms'] for t in staff])} |")
print(f"| Muse Spark: gloss generation (all attempts) | {stat([t.get('model_ms') for t in staff])} |")
print(f"| Gloss validation: rule checks + Muse Spark meaning check | {stat([t.get('check_ms') for t in staff])} |")
print(f"| Server total: glossmap + checks + playable-sign gate | {stat([t['llm_ms'] for t in staff])} |")
print(f"| Avatar: clip load → first frame | {stat([t['first_frame_ms'] for t in staff + replay])} |")
print(f"| Avatar: whole sequence back to rest | {stat([t.get('avatar_total_ms') or t.get('total_ms') for t in staff + replay])} |")
print(f"| **Speech → avatar starts** (ASR + server + first frame) | {stat([t['asr_ms'] + t['llm_ms'] + t['first_frame_ms'] for t in staff if t.get('first_frame_ms') is not None])} |")
rec = [x for t in patient for x in (t.get("recog_ms") or [])]
s2t = [x for t in patient for x in (t.get("sign_to_text_ms") or []) if x > 50]
print(f"| Recognition: classify a finished sign (after 0.35 s hands-down) | {stat(rec)} |")
print(f"| Patient: sign event → provisional sentence on screen (LLM) | {stat(s2t)} |")
print()
oc = {k: sum(r.get("patient_outcomes", {}).get(k, 0) for r in runs) for k in ("correct", "retry", "wrong")}
print(f"Patient outcomes: {oc}; screen violations: {sum(r.get('screen_violation_count', 0) for r in runs)}; "
      f"duplicates suppressed: {sum(t.get('duplicates_suppressed', 0) for t in patient)}; "
      f"text-only shown: {sum(1 for t in staff if t.get('text') and t.get('text_only_ok'))}/{sum(1 for t in staff if t.get('text'))} staff lines with unsigned words")
print()
for r in runs:
    print(f"Run {r['run']}:")
    for t in r["turns"]:
        if t.get("error"):
            print(f"- ERROR {t['error']}")
        elif t["who"] == "patient":
            rec = ", ".join(f"{s['label']} {s['confidence']:.2f}" for s in t["recognized"])
            unc = [u["label"] or "?" for u in t.get("uncertain") or []]
            print(f"- P{t['line']} expect {' '.join(t['expect'])} | got {rec} | \"{t['text']}\" ({t['source']}"
                  + (f", uncertain {' '.join(unc)}" if unc else "") + ")")
        elif t.get("replay"):
            print(f"- S{t['line']} replay {' '.join(t['signs'])}")
        else:
            print(f"- S{t['line']} \"{t['sentence']}\" → {' '.join(t['signs'])}"
                  + (f" + text {t['text']}" if t["text"] else "") + f" (attempts {t['attempts']})")
    print()

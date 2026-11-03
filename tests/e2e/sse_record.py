"""Record the recognizer's sign events with arrival times (seconds since start).

    python tests/e2e/sse_record.py out.jsonl [--url http://127.0.0.1:8770] [--until-ended]

Stops when the recognizer reports the source ended (status ended=true) or on Ctrl+C.
"""
import argparse
import json
import time

import requests

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--url", default="http://127.0.0.1:8770")
args = ap.parse_args()

t0 = None
with open(args.out, "w", encoding="utf-8") as f:
    while True:
        try:
            with requests.get(args.url + "/events", stream=True, timeout=60) as r:
                for raw in r.iter_lines():   # bytes: decode whole lines, never split UTF-8
                    line = raw.decode("utf-8") if raw else ""
                    if not line.startswith("data: "):
                        continue
                    m = json.loads(line[6:])
                    if t0 is None:
                        t0 = time.time()
                    m["t"] = round(time.time() - t0, 3)
                    if m["type"] == "sign":
                        f.write(json.dumps(m, ensure_ascii=False) + "\n")
                        f.flush()
                        print(m["t"], m["label"], m["confidence"], flush=True)
                    elif m.get("ended"):
                        print("ended", m["t"], flush=True)
                        raise SystemExit(0)
        except requests.ConnectionError:
            time.sleep(1)  # recognizer still starting

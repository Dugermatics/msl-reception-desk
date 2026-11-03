"""Record the staff lines for the speech-to-text test.

Shows each sentence; press Enter to start, Enter again to stop. Saves
16 kHz mono WAV files to the folder given (default: outside the repo, since
these are voice recordings).

Usage: python asr/record_lines.py [out_dir] [--only 3 ...]
"""
import sys
import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from eval_demo import CASES  # noqa: E402

RATE = 16000
_args = sys.argv[1:]
ONLY = {int(a) for a in _args[_args.index("--only") + 1:]} if "--only" in _args else None
_pos = _args[:_args.index("--only")] if "--only" in _args else _args
OUT = Path(_pos[0] if _pos else "staff_audio")


def record_until_enter():
    chunks, stop = [], threading.Event()

    def cb(indata, frames, t, status):
        chunks.append(indata.copy())

    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", callback=cb):
        input()
    return np.concatenate(chunks) if chunks else np.zeros((0, 1), dtype="int16")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Microphone: {sd.query_devices(kind='input')['name']}\nSaving to {OUT}\n")
    for i, (sentence, *_rest) in enumerate(CASES, 1):
        if ONLY and i not in ONLY:
            continue
        path = OUT / f"line{i:02d}.wav"
        while True:
            print(f"[{i}/{len(CASES)}]  {sentence}")
            input("   Enter = start ")
            print("   ... recording, Enter = stop")
            audio = record_until_enter()
            secs = len(audio) / RATE
            peak = int(np.abs(audio).max()) if len(audio) else 0
            if secs < 0.5 or peak < 500:
                print(f"   too short or too quiet ({secs:.1f}s, peak {peak}); again\n")
                continue
            with wave.open(str(path), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(RATE)
                w.writeframes(audio.tobytes())
            print(f"   saved {path.name} ({secs:.1f}s)")
            if input("   r = redo, Enter = next ").strip().lower() != "r":
                break
        print()
    print("Done.")

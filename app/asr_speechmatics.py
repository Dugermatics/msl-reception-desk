"""Speechmatics real-time ASR for Mongolian, kept server-side so the API key
never reaches the browser.

One RTSession per utterance stream: send 16 kHz mono s16le PCM chunks with
send_audio(); partial and final transcripts arrive through the on_message
callback as {"type": "partial"|"final"|"utterance_end"|"error", ...}.

The key is read from SPEECHMATICS_API_KEY (the repo's .env, or the file named
by SPEECHMATICS_ENV).
"""
from __future__ import annotations

import asyncio
import json
import os
import time

import aiohttp

RT_URL = os.environ.get("SPEECHMATICS_RT_URL", "wss://eu2.rt.speechmatics.com/v2")
SAMPLE_RATE = 16000


def start_message(language: str = "mn") -> dict:
    return {
        "message": "StartRecognition",
        "audio_format": {"type": "raw", "encoding": "pcm_s16le", "sample_rate": SAMPLE_RATE},
        "transcription_config": {
            "language": language,
            "operating_point": "enhanced",
            "enable_partials": True,
            "max_delay": 1.5,
            # Speechmatics closes an utterance after this much silence; that is
            # the moment the sentence goes to glossmap.
            "conversation_config": {"end_of_utterance_silence_trigger": 1.0},        },
    }


class RTSession:
    def __init__(self, on_message, language: str = "mn"):
        self.on_message = on_message
        self.language = language
        self.ws = None
        self.http = None
        self.reader = None
        self.seq = 0
        self.final_parts: list[str] = []
        self.t_last_audio = None   # wall time of the last audio chunk sent
        self.started = asyncio.Event()
        self.closed = asyncio.Event()

    async def open(self):
        key = os.environ.get("SPEECHMATICS_API_KEY")
        if not key:
            raise RuntimeError("SPEECHMATICS_API_KEY is not set")
        self.http = aiohttp.ClientSession()
        self.ws = await self.http.ws_connect(RT_URL, headers={"Authorization": f"Bearer {key}"}, heartbeat=20)
        await self.ws.send_str(json.dumps(start_message(self.language)))
        self.reader = asyncio.create_task(self._read())
        await asyncio.wait_for(self.started.wait(), timeout=10)

    async def send_audio(self, pcm: bytes):
        if self.ws is None or self.ws.closed:
            return
        self.seq += 1
        self.t_last_audio = time.time()
        await self.ws.send_bytes(pcm)

    async def finish(self, timeout: float = 10.0):
        """Flush: EndOfStream, wait for EndOfTranscript, close."""
        try:
            if self.ws is not None and not self.ws.closed:
                await self.ws.send_str(json.dumps({"message": "EndOfStream", "last_seq_no": self.seq}))
                await asyncio.wait_for(self.closed.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass
        finally:
            await self.close()

    async def close(self):
        if self.ws is not None and not self.ws.closed:
            await self.ws.close()
        if self.reader is not None:
            self.reader.cancel()
        if self.http is not None:
            await self.http.close()
        self.closed.set()

    def _flush_utterance(self, now):
        text = " ".join(p for p in self.final_parts if p).strip()
        self.final_parts = []
        if text:
            return {"type": "utterance_end", "text": text, "t": now}
        return None

    async def _read(self):
        try:
            async for msg in self.ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    if msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                        break
                    continue
                m = json.loads(msg.data)
                kind = m.get("message")
                now = time.time()
                if kind == "RecognitionStarted":
                    self.started.set()
                elif kind == "AddPartialTranscript":
                    await self.on_message({"type": "partial", "text": m["metadata"]["transcript"].strip(), "t": now})
                elif kind == "AddTranscript":
                    part = m["metadata"]["transcript"].strip()
                    if part:
                        self.final_parts.append(part)
                        await self.on_message({"type": "final", "text": part, "t": now,
                                               "end_time": m["metadata"].get("end_time")})
                elif kind == "EndOfUtterance":
                    out = self._flush_utterance(now)
                    if out:
                        await self.on_message(out)
                elif kind == "EndOfTranscript":
                    out = self._flush_utterance(now)
                    if out:
                        await self.on_message(out)
                    break
                elif kind == "Error":
                    self.started.set()
                    await self.on_message({"type": "error", "text": f"{m.get('type')}: {m.get('reason')}", "t": now})
                    break
                elif kind == "Warning":
                    await self.on_message({"type": "warning", "text": m.get("reason", ""), "t": now})
        except asyncio.CancelledError:
            pass
        except Exception as e:  # network drop, or a failing callback
            self.started.set()
            await self.on_message({"type": "error", "text": f"ASR connection: {e}", "t": time.time()})
        finally:
            self.closed.set()

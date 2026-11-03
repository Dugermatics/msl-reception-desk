"""Offline checks for sign2text (no model call) and the avatar's playable-sign gate."""
import sign2text
from app import server

VOCAB = sign2text.load_vocab()


def test_accepts_grammar_only_sentence():
    assert sign2text.check(["minii_manai", "huuhed", "uvduh"],
                           {"text": "Миний хүүхэд өвдөж байна.", "used": ["minii_manai", "huuhed", "uvduh"]}, VOCAB) == []


def test_rejects_added_content():
    problems = sign2text.check(["hodood"], {"text": "Ходоод маш их өвдөж байна.", "used": ["hodood"]}, VOCAB)
    assert problems and "маш" in problems[0]


def test_rejects_dropped_sign():
    assert sign2text.check(["uuchlaarai", "dahin"], {"text": "Уучлаарай.", "used": ["uuchlaarai"]}, VOCAB)


def test_low_confidence_never_reaches_the_model(monkeypatch):
    called = []
    monkeypatch.setattr(sign2text.glossmap, "complete", lambda m: called.append(m) or "{}")
    r = sign2text.to_text([{"label": "huuhed", "confidence": 0.3}], VOCAB)
    assert r["source"] == "none" and r["uncertain"][0]["label"] == "huuhed" and not called


def test_no_sentence_around_an_uncertain_sign(monkeypatch):
    called = []
    monkeypatch.setattr(sign2text.glossmap, "complete", lambda m: called.append(m) or "{}")
    r = sign2text.to_text([{"label": "huuhed", "confidence": 0.95}, {"label": "uvduh", "confidence": 0.4}], VOCAB)
    assert r["source"] == "uncertain" and r["text"] == "" and r["glosses"] == ["huuhed"] and not called


def test_translate_refuses_empty_text():
    assert server.translate("")["en"] == ""


def test_model_failure_falls_back_to_glosses(monkeypatch):
    def boom(_):
        raise TimeoutError
    monkeypatch.setattr(sign2text.glossmap, "complete", boom)
    r = sign2text.to_text([{"label": "bayarlalaa", "confidence": 0.9}], VOCAB)
    assert r["source"] == "glosses" and r["text"] == "Баярлалаа." and not r["verified"]


def test_gate_never_plays_unplayable_sign(monkeypatch):
    monkeypatch.setattr(server.glossmap, "to_signs", lambda s, v: {"signs": ["emch", "not_a_sign"], "text": [],
                                                                    "verified": True, "attempts": 1})
    r = server.gloss("Эмч ирнэ.")
    assert r["signs"] == ["emch"] and r["rejected"] == ["not_a_sign"] and "Эмч ирнэ." in r["text"]


def test_gate_api_failure_shows_text_only(monkeypatch):
    def boom(s, v):
        raise ConnectionError
    monkeypatch.setattr(server.glossmap, "to_signs", boom)
    r = server.gloss("Түр хүлээнэ үү.")
    assert r["signs"] == [] and r["text"] == ["Түр хүлээнэ үү."] and "error" in r

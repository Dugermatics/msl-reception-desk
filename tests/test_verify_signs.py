"""Offline tests for the deterministic rules (no model call).

Run: python -m pytest tests
"""
from verification.verify_signs import run_verification

VOCAB = [{"id": "emch"}, {"id": "huleeh"}, {"id": "uvduh"}]
SENTENCE = "Ойлголоо. Эмчид үзүүлье. Түр хүлээнэ үү."


def test_faithful_result_passes():
    out = {"signs": ["emch", "huleeh"], "text": ["Ойлголоо", "үзүүлье"]}
    assert run_verification(SENTENCE, out, VOCAB)["passed"]


def test_inflected_text_counts_as_said():
    out = {"signs": [], "text": ["эмч үзүүлэх"]}
    assert run_verification(SENTENCE, out, VOCAB)["passed"]


def test_unknown_sign_fails():
    r = run_verification(SENTENCE, {"signs": ["emch", "Hospital"], "text": []}, VOCAB)
    assert not r["passed"] and "Hospital" in r["feedback"][0]


def test_added_advice_in_text_fails():
    out = {"signs": ["emch"], "text": ["парацетамол уугаарай"]}
    r = run_verification(SENTENCE, out, VOCAB)
    assert not r["passed"] and "парацетамол" in r["feedback"][0]


def test_wrong_shape_fails():
    assert not run_verification(SENTENCE, {"signs": "emch", "text": []}, VOCAB)["passed"]
    assert not run_verification(SENTENCE, {"signs": [], "text": [1]}, VOCAB)["passed"]

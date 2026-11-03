"""Checks every glossmap result must pass before the avatar signs it.

Each check is one module with one entry point that returns
{"passed": bool, "feedback": [problem, ...]}. glossmap.to_signs calls them at
a fixed point, so the model cannot skip them: deterministic rules first
(verify_signs), then a Muse Spark judge (verify_meaning).
"""

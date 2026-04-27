"""
session.py — In-memory conversation session store.

Each unique conversation_id gets a session dict that persists for 30 minutes
of inactivity. Sessions are stored in a plain Python dict (_SESSIONS) — they
are lost on server restart, which is acceptable for a lightweight support bot.

Tracked fields per session:
  last_intent   — the intent detected in the most recent message
  last_products — product list returned in the most recent reply
  last_budget   — budget extracted from the most recent message
  last_category — product category from the most recent message
  unknown_count — consecutive messages with intent == "unknown"
                  used by main.py to trigger admin handoff at threshold 2

Usage:
    sess = session.get(conversation_id)   # create or retrieve
    session.update(conversation_id, unknown_count=0, last_intent="gift")
"""
from __future__ import annotations
import time

# Keyed by conversation_id string (UUID assigned by main.py).
_SESSIONS: dict[str, dict] = {}

# Sessions expire after 30 minutes of inactivity and are removed on next access.
_TTL = 1800


def _cleanup() -> None:
    """Evict sessions that have been inactive longer than _TTL seconds."""
    now = time.time()
    stale = [k for k, v in _SESSIONS.items() if now - v["ts"] > _TTL]
    for k in stale:
        del _SESSIONS[k]


def get(cid: str) -> dict:
    """
    Return the session for `cid`, creating a fresh one if it doesn't exist.
    Also triggers TTL cleanup of expired sessions on every call.
    """
    _cleanup()
    if cid not in _SESSIONS:
        _SESSIONS[cid] = {
            "last_intent":   None,
            "last_products": [],
            "last_budget":   None,
            "last_category": None,
            "unknown_count": 0,
            "ts":            time.time(),   # last-touched timestamp
        }
    return _SESSIONS[cid]


def update(cid: str, **kwargs) -> None:
    """
    Merge `kwargs` into the session for `cid` and refresh its timestamp.
    Call this after every /analyze request to keep session state current.
    """
    sess = get(cid)
    sess.update(kwargs)
    sess["ts"] = time.time()

"""
analyzer.py — Intent detection and entity extraction.

This module converts a raw customer message string into a structured dict:
    {
        "intent":    str,           # e.g. "gift", "shipping", "order_lookup"
        "budget":    float | None,  # e.g. 1500.0 extracted from "under ฿1500"
        "tokens":    list[str],     # lowercase word tokens for keyword matching
        "trigger":   bool,          # True if message contains "@abona"
        "matched":   str | None,    # which keyword triggered the intent
        "category":  str | None,    # e.g. "clothing" — DB type column value
        "order_ref": str | None,    # UUID extracted from message, if any
    }

Tokenization strategy:
  - If spaCy is installed (recommended), uses en_core_web_sm for better
    lemmatization — e.g. "shipped" → "ship" matches the "ship" keyword.
  - Falls back to a regex tokenizer that handles Latin + Thai script.
    Both paths produce a flat list of lowercase strings.
"""
from __future__ import annotations

import re
from typing import Optional

from intents import INTENTS, TRIGGER_MENTION, CATEGORY_MAP

# ---------------------------------------------------------------------------
# Optional spaCy — gracefully degrade to regex if unavailable.
# ---------------------------------------------------------------------------
_nlp = None
try:
    import spacy
    try:
        _nlp = spacy.load("en_core_web_sm")
    except OSError:
        # Model not downloaded — pip install spacy && python -m spacy download en_core_web_sm
        _nlp = None
except ImportError:
    _nlp = None  # spaCy not installed; regex tokenizer will be used instead

# Regex tokenizer: matches sequences of Latin/Thai letters and contractions,
# plus numbers (for budget extraction). Handles Thai without word boundaries.
_TOKEN_RE = re.compile(r"[A-Za-z฀-๿]+(?:'[A-Za-z]+)?|\d[\d,]*", re.UNICODE)

# UUID pattern used to detect order references in messages.
# Example match: "01d85a8b-dea3-4a47-8c25-0257d3722b6c"
_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
)

# Words that negate an adjacent keyword — prevents "I don't want a gift"
# from matching the "gift" intent.
_NEGATIONS = {"not", "no", "don't", "dont", "never", "without"}


# ---------------------------------------------------------------------------
# Tokenization
# ---------------------------------------------------------------------------
def _tokenize(message: str) -> list[str]:
    """Return a flat list of lowercase tokens from the message."""
    lowered = message.lower()
    if _nlp is not None:
        # spaCy tokenizer — includes punctuation stripping and lemmatization.
        return [t.text for t in _nlp(lowered) if not t.is_space]
    # Regex fallback: extract word-like and number sequences.
    return _TOKEN_RE.findall(lowered)


# ---------------------------------------------------------------------------
# Budget extraction
# ---------------------------------------------------------------------------
def _extract_budget(message: str) -> Optional[float]:
    """
    Extract a numeric budget from natural language.
    Handles:  "under ฿1500", "below 2000", "500 baht", "1.5k"
    Returns None if no budget-like number is found, or if the number
    is below 50 (avoids treating age, quantity, etc. as prices).
    """
    text = message.lower().replace(",", "")

    # "1.5k" / "2k" → multiply by 1000
    k_match = re.search(r"(\d+(?:\.\d+)?)\s*k\b", text)
    if k_match:
        return float(k_match.group(1)) * 1000

    # Look for a number optionally preceded by a price indicator word/symbol.
    num_match = re.search(
        r"(?:under|below|less than|max|฿|\$)?\s*(\d+(?:\.\d+)?)", text
    )
    if num_match:
        value = float(num_match.group(1))
        if value >= 50:  # ignore small numbers that are unlikely to be prices
            return value
    return None


# ---------------------------------------------------------------------------
# Negation check
# ---------------------------------------------------------------------------
def _is_negated(tokens: list[str], keyword: str) -> bool:
    """
    Return True if a negation word appears within 3 tokens before `keyword`.
    Example: ["don't", "want", "a", "gift"] → _is_negated(tokens, "gift") == True
    """
    try:
        idx = tokens.index(keyword)
    except ValueError:
        return False
    window = tokens[max(0, idx - 3):idx]
    return any(tok in _NEGATIONS for tok in window)


# ---------------------------------------------------------------------------
# Entity extractors
# ---------------------------------------------------------------------------
def _extract_category(tokens: list[str], message: str) -> Optional[str]:
    """
    Return the DB `type` value (e.g. 'clothing') if the message contains
    a category keyword from CATEGORY_MAP. Multi-word keywords are matched
    as substrings of the full message; single words against the token list.
    """
    lowered = message.lower()
    for cat, keywords in CATEGORY_MAP.items():
        for kw in keywords:
            if " " in kw:
                if kw in lowered:
                    return cat
            elif kw in tokens:
                return cat
    return None


def _extract_order_ref(message: str) -> Optional[str]:
    """
    Return the first UUID found in the message, or None.
    Abona orders use UUID v4 as primary key — users paste them from
    their confirmation email to look up order status.
    """
    m = _UUID_RE.search(message)
    return m.group(0) if m else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def has_trigger(message: str) -> bool:
    """Return True if the message contains the @abona trigger mention."""
    return TRIGGER_MENTION.lower() in message.lower()


def detect_intent(message: str) -> dict:
    """
    Main entry point. Parse `message` and return a structured intent dict.

    Resolution order (first rule that matches wins):
      1. Keyword matching against INTENTS dict (top-to-bottom priority)
      2. Budget fallback: if no intent matched but a price was found → "budget"
      3. Category override: if a product-type word found → "category"
      4. Order UUID override: if a UUID is present → "order_lookup"
    """
    tokens = _tokenize(message)
    intent = "unknown"
    matched_keyword = None

    lowered = message.lower()

    # Step 1 — iterate INTENTS in priority order, stop at first match.
    for name, keywords in INTENTS.items():
        for kw in keywords:
            if " " in kw or not kw.isascii():
                # Multi-word or Thai keyword → substring match on full message.
                if kw in lowered:
                    intent = name
                    matched_keyword = kw
                    break
            elif kw in tokens and not _is_negated(tokens, kw):
                # Single ASCII keyword → token-list match (avoids partial words).
                intent = name
                matched_keyword = kw
                break
        if intent != "unknown":
            break

    # Step 2 — budget fallback: plain price with no other recognised intent.
    budget = _extract_budget(message)
    if intent == "unknown" and budget is not None:
        intent = "budget"
        matched_keyword = "<price>"

    # Step 3 — category override: "show me clothing" → intent = "category".
    # Only overrides broad/vague intents; specific ones (gift, best) are kept.
    category = _extract_category(tokens, message)
    if category and intent in ("unknown", "product_search"):
        intent = "category"

    # Step 4 — order UUID always wins: user is clearly asking about a specific order.
    order_ref = _extract_order_ref(message)
    if order_ref:
        intent = "order_lookup"

    return {
        "intent":    intent,
        "budget":    budget,
        "tokens":    tokens,
        "trigger":   has_trigger(message),
        "matched":   matched_keyword,
        "category":  category,
        "order_ref": order_ref,
    }

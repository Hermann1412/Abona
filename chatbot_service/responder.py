"""
responder.py — Builds the final reply sent back to the customer.

Takes the structured intent dict from analyzer.py + the product/order data
from db.py and produces a human-readable JSON response:
    {
        "reply":    str,        # markdown-formatted message text
        "products": list[dict]  # [] for static replies, list for product results
    }

Routing logic:
  ┌──────────────────────────────────────────────────────┐
  │  intent == "order_lookup"  →  _build_order_reply()   │
  │  intent in STATIC_INTENTS  →  POLICY_REPLIES lookup  │
  │  intent in PRODUCT_INTENTS →  product list formatter │
  │  anything else             →  fallback reply         │
  └──────────────────────────────────────────────────────┘
"""
from __future__ import annotations
from typing import Optional

from intents import POLICY_REPLIES, STATIC_INTENTS, PRODUCT_INTENTS, CATEGORY_DISPLAY


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _format_baht(cents: int) -> str:
    """Convert integer cents to a ฿-prefixed formatted string. 120000 → '฿1,200'."""
    baht = cents // 100
    return f"฿{baht:,}"


# Maps the DB `type` column value to an emoji for text-mode replies.
# The test_chat.html frontend uses product card images instead, but this
# is used as a fallback and in terminal mode.
_TYPE_EMOJI = {
    "clothing": "👗",
    "kitchen":  "🍳",
    "sports":   "🏃",
    "other":    "🛍",
    # Legacy SQLite seed types (not in real MySQL, kept for dev mode).
    "fragrance": "🌸",
    "perfume":   "🌸",
    "candle":    "🕯",
    "bath":      "🛁",
    "body":      "💆",
    "skincare":  "🧴",
    "home":      "🏠",
    "gift":      "🎁",
}

# Maps order status strings to status indicator emojis.
_STATUS_EMOJI = {
    "pending":    "⏳",
    "paid":       "✅",
    "processing": "🔄",
    "shipped":    "🚚",
    "delivered":  "📬",
    "cancelled":  "❌",
    "refunded":   "↩️",
}


def _emoji_for(p: dict) -> str:
    """
    Choose an emoji for a product. Preference order:
      1. If the `image` field IS already an emoji (short, no path chars) → use it.
      2. Map product `type` to _TYPE_EMOJI.
      3. Default to 🛍.
    """
    img = p.get("image") or ""
    if img and "/" not in img and "." not in img and len(img) <= 4:
        return img   # SQLite seed products store emojis directly in the image field
    ptype = (p.get("type") or "").lower()
    return _TYPE_EMOJI.get(ptype, "🛍")


def _format_product_line(p: dict) -> str:
    """
    Format a single product as a markdown text line.
    Used in terminal mode and as a text fallback; the browser UI renders
    proper product cards from the `products` array in the JSON response.
    """
    emoji   = _emoji_for(p)
    name    = p.get("name", "Unnamed")
    price   = _format_baht(p.get("price_cents", 0))
    stars   = p.get("stars", 0)
    reviews = p.get("review_count", 0)
    review_part = f" ({reviews} reviews)" if reviews else ""
    return f"{emoji} **{name}**\n{price} · ⭐ {stars}{review_part}"


def _intro_for(intent: str, budget, category: Optional[str] = None) -> str:
    """Return the opening line for a product list reply based on intent."""
    if intent == "gift":
        if budget:
            return f"Great choice! Here are gift ideas under ฿{int(budget):,} 🎁"
        return "Here are some lovely gift ideas 🎁"
    if intent == "budget":
        return f"Here's what we've got under ฿{int(budget):,} 💰" if budget else "Our most affordable picks 💰"
    if intent == "best":
        return "⭐ Our top picks right now:"
    if intent == "category":
        # Use the human-readable label (e.g. "Clothing & Fashion") from CATEGORY_DISPLAY.
        label = CATEGORY_DISPLAY.get(category or "", "Products")
        if budget:
            return f"🛍 **{label}** under ฿{int(budget):,}:"
        return f"🛍 Here's what we have in **{label}**:"
    if intent == "product_search":
        return "🛍 Here's what matched your search:"
    return "Here are some picks you might like:"


# ---------------------------------------------------------------------------
# Order reply builder
# ---------------------------------------------------------------------------
def _build_order_reply(intent_result: dict, order: Optional[dict]) -> dict:
    """
    Build a reply for the 'order_lookup' intent.

    Three cases:
      1. No UUID in message → ask the user to provide one.
      2. UUID provided but not found in DB → not-found message.
      3. Order found → formatted status card.
    """
    order_ref = intent_result.get("order_ref")

    # Case 1 — user said "check my order" with no UUID.
    if not order_ref:
        return {"reply": POLICY_REPLIES["order_lookup_ask"], "products": []}

    # Case 2 — UUID present but order not found (wrong ID, or wrong account).
    if not order:
        return {
            "reply": (
                f"❌ No order found with ID `{order_ref}`.\n"
                "Please double-check the ID from your confirmation email and try again."
            ),
            "products": [],
        }

    # Case 3 — order found; format a status summary.
    emoji   = _STATUS_EMOJI.get(order["status"], "📦")
    baht    = order["total_baht"]
    city    = order.get("shipping_city") or ""
    country = order.get("shipping_country") or ""
    location = ", ".join(filter(None, [city, country]))   # skip empty parts

    created = order["created_at"]
    date    = (created.strftime("%d %b %Y")
               if hasattr(created, "strftime") else str(created))

    lines = [
        f"{emoji} **Order found!**",
        f"Status: **{order['status'].upper()}**",
        f"Total: ฿{baht:,.2f}",
        f"Placed: {date}",
    ]
    if location:
        lines.append(f"Shipping to: {location}")

    return {"reply": "\n".join(lines), "products": []}


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def build_reply(intent_result: dict, products: list[dict],
                order: Optional[dict] = None) -> dict:
    """
    Build and return the final reply dict.

    Parameters
    ----------
    intent_result : dict
        Output of analyzer.detect_intent().
    products : list[dict]
        Output of db.search_products() — empty list for static intents.
    order : dict | None
        Output of db.lookup_order() — only populated for order_lookup intent.

    Returns
    -------
    {"reply": str, "products": list[dict]}
    """
    intent   = intent_result.get("intent", "unknown")
    budget   = intent_result.get("budget")
    category = intent_result.get("category")

    # --- Order lookup: custom handler (not in STATIC or PRODUCT_INTENTS) ---
    if intent == "order_lookup":
        return _build_order_reply(intent_result, order)

    # --- Static replies: just return the pre-written policy text ---
    if intent in STATIC_INTENTS:
        return {"reply": POLICY_REPLIES[intent], "products": []}

    # --- Product lookup replies ---
    if intent in PRODUCT_INTENTS:
        if not products:
            # Personalise the "nothing found" message by intent and budget.
            if budget:
                msg = (
                    f"Hmm, I couldn't find anything under ฿{int(budget):,} for that.\n"
                    "Try raising the budget a little or ask for `@abona best` to see our top picks!"
                )
            elif intent == "category":
                label = CATEGORY_DISPLAY.get(category or "", "that category")
                msg = (
                    f"I couldn't find any **{label}** products right now.\n"
                    "Try `@abona best` to browse all available items."
                )
            else:
                msg = (
                    "I couldn't find a great match just now.\n"
                    "Try `@abona best` for our top picks, or browse by category:\n"
                    "`@abona clothing` · `@abona kitchen` · `@abona sports`"
                )
            return {"reply": msg, "products": []}

        # Build the product list reply.
        lines = [_intro_for(intent, budget, category), ""]
        for p in products:
            lines.append(_format_product_line(p))
            lines.append("")
        lines.append("Type a product name to learn more! 💬")
        return {"reply": "\n".join(lines).strip(), "products": products}

    # --- Fallback for completely unrecognised intent ---
    return {"reply": POLICY_REPLIES["fallback"], "products": []}

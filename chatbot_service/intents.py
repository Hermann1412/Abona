"""
intents.py — Keyword rules, policy responses, and category mappings.

This file is the single source of truth for:
  1. INTENTS        — ordered dict of intent → trigger keywords
  2. CATEGORY_MAP   — maps DB `type` values to user-facing words
  3. POLICY_REPLIES — static text responses (no DB lookup needed)
  4. STATIC_INTENTS / PRODUCT_INTENTS — used by responder to route replies

How intent matching works (analyzer.py iterates this dict top-to-bottom):
  - The FIRST matching intent wins, so ORDER MATTERS.
  - Put narrow/specific intents (order_lookup, gift) BEFORE broad ones (product_search).
  - Multi-word keywords (e.g. "how long") are matched as substrings of the full message.
  - Single-word keywords are matched against the token list to avoid partial-word false positives.
"""

# ---------------------------------------------------------------------------
# Category mapping
# ---------------------------------------------------------------------------

# Maps the DB `products.type` column value → list of words a user might type.
# analyzer.py reads this to detect category intent and pass the DB key downstream.
CATEGORY_MAP = {
    "clothing": ["clothing", "clothes", "shirt", "shirts", "dress", "dresses",
                 "pants", "fashion", "apparel", "wear", "outfit", "outfits",
                 "เสื้อ", "กางเกง", "ชุด", "แฟชั่น"],
    "kitchen":  ["kitchen", "cookware", "cooking", "utensil", "utensils",
                 "cook", "bake", "baking", "ครัว", "หม้อ", "กระทะ"],
    "sports":   ["sports", "fitness", "gym", "exercise", "workout",
                 "sport", "athletic", "running", "กีฬา", "ออกกำลังกาย"],
    "other":    ["other", "general", "accessories", "accessory",
                 "อื่น", "อุปกรณ์"],
}

# Human-readable label for each DB type — shown in bot replies and product cards.
CATEGORY_DISPLAY = {
    "clothing": "Clothing & Fashion",
    "kitchen":  "Kitchen & Cookware",
    "sports":   "Sports & Fitness",
    "other":    "General Products",
}

# ---------------------------------------------------------------------------
# Intent keyword rules  (ORDER = PRIORITY — first match wins)
# ---------------------------------------------------------------------------
INTENTS = {
    # Simple greetings — static reply, no DB needed.
    "greeting":     ["hi", "hello", "hey", "hiya", "howdy", "สวัสดี", "ครับ", "ค่ะ"],

    # Order status lookup — must come BEFORE product_search so "check my order"
    # doesn't fall through to the search path.
    "order_lookup": ["order", "orders", "my order", "order status",
                     "where is my", "check my order", "track my order"],

    # Gift / occasion — returns products tagged as gifts (or falls back to any products).
    "gift":         ["gift", "gifts", "present", "presents", "surprise",
                     "birthday", "anniversary", "ของขวัญ"],

    # Budget-driven search — triggers when the user mentions a price constraint.
    "budget":       ["cheap", "budget", "under", "below", "affordable",
                     "inexpensive", "ถูก", "ราคาถูก"],

    # Best / recommendations — returns top-rated active products.
    "best":         ["popular", "best", "top", "trending", "bestseller",
                     "bestsellers", "recommend", "recommendation",
                     "ยอดนิยม", "แนะนำ"],

    # Policy — shipping, returns, payment (all static text, no DB).
    "shipping":     ["shipping", "delivery", "deliver", "arrive", "arrives",
                     "ship", "shipped", "courier", "how long", "track",
                     "tracking", "ส่ง", "จัดส่ง", "ค่าส่ง"],
    "returns":      ["return", "returns", "refund", "refunds", "exchange",
                     "exchanges", "send back", "คืน", "คืนสินค้า", "เปลี่ยน"],
    "payment":      ["pay", "payment", "payments", "card", "cards", "stripe",
                     "wallet", "visa", "mastercard", "ชำระ", "จ่าย", "บัตร"],

    # Generic product search — broadest intent, always last.
    "product_search": ["suggest", "want", "looking", "need", "buy", "find", "show"],
}

# The @mention that activates the bot inside the Abona chat room.
TRIGGER_MENTION = "@abona"

# ---------------------------------------------------------------------------
# Static policy replies (returned as-is, no DB query)
# ---------------------------------------------------------------------------
POLICY_REPLIES = {
    "shipping": (
        "📦 We ship Thailand-wide within **2–4 business days**. "
        "International shipping takes 7–14 days. "
        "You'll get a tracking number by email once your order ships."
    ),
    "returns": (
        "↩️ We offer a **7-day return policy** on all items in original condition. 📦\n"
        "To start a return, contact our team through this chat or email us. "
        "Refunds are processed within 3–5 business days."
    ),
    "payment": (
        "💳 We accept Visa, Mastercard, AMEX, Apple Pay and Google Pay. "
        "All payments are processed securely via Stripe — your card details never touch our servers."
    ),
    "greeting": (
        "👋 Hi there! Welcome to Abona Shop.\n"
        "Type **@abona** followed by your question for instant product ideas, "
        "or just ask about shipping, returns, or payment — I've got you."
    ),
    # Shown when a user says "check my order" but provides no UUID.
    "order_lookup_ask": (
        "🔍 Sure! Please share your **order ID** (the UUID from your confirmation email) "
        "and I'll pull up the status right away.\n"
        "It looks like: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`"
    ),
    # Triggered by Node.js 30-second timer when no admin has replied.
    "admin_away": (
        "👋 Hi there! Our support team will be with you shortly.\n"
        "In the meantime, try typing **@abona** followed by your question "
        "for instant product recommendations and answers!"
    ),
    # Triggered after 2 consecutive unknown intents — escalates to a human.
    "handoff": (
        "🙋 It looks like you need a bit more help than I can offer right now!\n"
        "I've flagged this conversation — a **human agent will join shortly**.\n"
        "You can also reach us by email anytime. Sorry for any trouble!"
    ),
    "fallback": (
        "🤖 I'm not quite sure what you're asking, but I can help with:\n"
        "• Product recommendations — try `@abona gift under ฿1500`\n"
        "• Shipping, returns, or payment questions\n"
        "A human agent will also join shortly."
    ),
}

# ---------------------------------------------------------------------------
# Intent routing sets (used by responder.py)
# ---------------------------------------------------------------------------

# These intents return a fixed text reply — no database query is performed.
STATIC_INTENTS  = {"shipping", "returns", "payment", "greeting",
                   "admin_away", "fallback", "handoff"}

# These intents trigger a product search and return a list of matching items.
PRODUCT_INTENTS = {"gift", "budget", "best", "product_search", "category"}

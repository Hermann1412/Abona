"""
main.py — FastAPI application entry point.

Exposes two HTTP endpoints:
    GET  /          → health check + active DB backend
    POST /analyze   → main bot endpoint

Message processing pipeline (POST /analyze):
    1. Parse request body (message, conversation_id, force_auto_reply).
    2. Load or create a conversation session from session.py.
    3. Detect intent via analyzer.detect_intent().
    4. Check for admin handoff: if unknown intent appears 2× in a row,
       escalate to the "handoff" reply and reset the counter.
    5. If intent == "order_lookup" and a UUID was found, query the orders table.
    6. If intent is a product intent, query the products table.
    7. Build the reply via responder.build_reply().
    8. Update the session with the current turn's context.
    9. Return JSON: {reply, products, intent, budget, conversation_id}.

Run locally:
    cd bot
    uvicorn main:app --reload --port 8000
"""
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from analyzer import detect_intent
from responder import build_reply
from db import search_products, backend_name, lookup_order
import session as _session   # aliased to avoid shadowing built-in

app = FastAPI(title="Abona AI Bot", version="2.0.0")

# Allow all origins so the standalone test_chat.html (opened as file://) can
# call the API. Tighten this to the Abona domain before production deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------
class AnalyzeRequest(BaseModel):
    message:          str
    conversation_id:  Optional[str]  = None   # omit for a new conversation
    force_auto_reply: Optional[bool] = False  # True = 30s admin-away timer fired


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    """Health check. Returns the active DB backend so clients can verify config."""
    return {
        "service":    "Abona AI Bot",
        "version":    "2.0.0",
        "status":     "ok",
        "db_backend": backend_name(),
        "endpoints":  ["POST /analyze"],
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """
    Main bot endpoint. Called by Node.js on every incoming customer message.

    force_auto_reply=True bypasses intent detection entirely and returns the
    admin_away courtesy message — used when no human agent has replied within
    the configured timeout (default 30 seconds in the Abona backend).
    """
    message = (req.message or "").strip()

    # Assign a conversation ID if the client didn't provide one.
    # Returning it in the response lets the client track it across turns.
    cid = req.conversation_id or str(uuid.uuid4())

    # -----------------------------------------------------------------------
    # Admin-away shortcut — skip all intent logic
    # -----------------------------------------------------------------------
    if req.force_auto_reply:
        intent_result = {
            "intent": "admin_away", "budget": None, "tokens": [],
            "trigger": False, "matched": None, "category": None, "order_ref": None,
        }
        payload = build_reply(intent_result, [], None)
        payload["intent"]          = "admin_away"
        payload["budget"]          = None
        payload["conversation_id"] = cid
        return payload

    # -----------------------------------------------------------------------
    # Normal path — detect intent, check session, query DB, build reply
    # -----------------------------------------------------------------------
    intent_result = detect_intent(message)
    sess = _session.get(cid)

    # Admin handoff: after 2 consecutive messages the bot can't understand,
    # escalate to a human instead of repeating the generic fallback.
    if intent_result["intent"] == "unknown":
        sess["unknown_count"] += 1
        if sess["unknown_count"] >= 2:
            # Override intent to trigger the handoff message and reset counter.
            intent_result = {**intent_result, "intent": "handoff"}
            sess["unknown_count"] = 0
    else:
        sess["unknown_count"] = 0   # any successful match resets the streak

    # Order lookup — only query the DB if a UUID was extracted from the message.
    order = None
    if intent_result["intent"] == "order_lookup":
        order_ref = intent_result.get("order_ref")
        if order_ref:
            order = lookup_order(order_ref)

    # Product search — search_products returns [] for non-product intents.
    products = search_products(intent_result)

    # Build the human-readable reply text + structured product list.
    payload = build_reply(intent_result, products, order)

    # Persist session state for the next turn.
    _session.update(
        cid,
        last_intent=intent_result["intent"],
        last_products=products,
        last_budget=intent_result.get("budget"),
        last_category=intent_result.get("category"),
        unknown_count=sess["unknown_count"],
    )

    # Attach metadata so the frontend can display intent label + budget badge.
    payload["intent"]          = intent_result["intent"]
    payload["budget"]          = intent_result.get("budget")
    payload["conversation_id"] = cid
    return payload

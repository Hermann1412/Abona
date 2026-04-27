"""
main.py — Flask application entry point.

Endpoints:
    GET  /          → health check
    POST /analyze   → main bot endpoint
"""
import uuid
import os
from flask import Flask, request, jsonify

from analyzer import detect_intent
from responder import build_reply
from db import search_products, backend_name, lookup_order
import session as _session

app = Flask(__name__)


@app.get("/")
def root():
    return jsonify({
        "service":    "Abona AI Bot",
        "version":    "2.0.0",
        "status":     "ok",
        "db_backend": backend_name(),
        "endpoints":  ["POST /analyze"],
    })


@app.post("/analyze")
def analyze():
    data             = request.get_json(force=True, silent=True) or {}
    message          = (data.get("message") or "").strip()
    cid              = data.get("conversation_id") or str(uuid.uuid4())
    force_auto_reply = bool(data.get("force_auto_reply", False))

    # Admin-away shortcut
    if force_auto_reply:
        intent_result = {
            "intent": "admin_away", "budget": None, "tokens": [],
            "trigger": False, "matched": None, "category": None, "order_ref": None,
        }
        payload = build_reply(intent_result, [], None)
        payload["intent"]          = "admin_away"
        payload["budget"]          = None
        payload["conversation_id"] = cid
        return jsonify(payload)

    # Normal path
    intent_result = detect_intent(message)
    sess = _session.get(cid)

    if intent_result["intent"] == "unknown":
        sess["unknown_count"] += 1
        if sess["unknown_count"] >= 2:
            intent_result = {**intent_result, "intent": "handoff"}
            sess["unknown_count"] = 0
    else:
        sess["unknown_count"] = 0

    order = None
    if intent_result["intent"] == "order_lookup":
        order_ref = intent_result.get("order_ref")
        if order_ref:
            order = lookup_order(order_ref)

    products = search_products(intent_result)
    payload  = build_reply(intent_result, products, order)

    _session.update(
        cid,
        last_intent=intent_result["intent"],
        last_products=products,
        last_budget=intent_result.get("budget"),
        last_category=intent_result.get("category"),
        unknown_count=sess["unknown_count"],
    )

    payload["intent"]          = intent_result["intent"]
    payload["budget"]          = intent_result.get("budget")
    payload["conversation_id"] = cid
    return jsonify(payload)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 8000)))

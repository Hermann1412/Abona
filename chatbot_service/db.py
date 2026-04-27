"""
db.py — Database access layer (READ-ONLY by design).

Supports two backends that share the same public API:
  ┌─────────────────────────────────────────────────────────────────┐
  │  SQLite  (default)  — zero-setup dev mode                       │
  │    • Uses bot/abona_test.db, auto-seeded with 15 sample items   │
  │    • No server, no credentials — just works out of the box      │
  ├─────────────────────────────────────────────────────────────────┤
  │  MySQL   (production)  — activated by DB_HOST env var           │
  │    • Connects to your real abona_shop database                  │
  │    • Uses a dedicated read-only user (aibot_readonly)           │
  └─────────────────────────────────────────────────────────────────┘

Read-only protection operates at TWO independent levels:
  Level 1 — Database user: aibot_readonly only has GRANT SELECT.
            MySQL rejects any non-SELECT statement before it runs.
  Level 2 — Code guard: _ensure_readonly() inspects every SQL string
            before sending it to the DB. It blocks INSERT, UPDATE,
            DELETE, DROP, etc. even if a future code change slips
            through — WriteAttemptedError is raised immediately.

Public functions:
  search_products(intent_result, limit=3)  → list[dict]
  lookup_order(order_ref)                  → dict | None
  backend_name()                           → "mysql" | "sqlite"
  is_readonly()                            → bool
"""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()  # loads DB_HOST, DB_USER, etc. from bot/.env
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Configuration — resolved once at import time
# ---------------------------------------------------------------------------
_BOT_DIR     = Path(__file__).resolve().parent
_SQLITE_PATH = os.getenv("SQLITE_PATH") or str(_BOT_DIR / "abona_test.db")
_USE_MYSQL   = bool(os.getenv("DB_HOST"))   # True → MySQL; False → SQLite
_READONLY    = os.getenv("READONLY", "true").lower() not in ("false", "0", "no")


# ---------------------------------------------------------------------------
# Level-2 read-only guard
# ---------------------------------------------------------------------------
_FORBIDDEN_KEYWORDS = (
    "insert", "update", "delete", "drop", "truncate", "alter", "create",
    "rename", "replace", "grant", "revoke", "lock", "unlock", "call",
)


class WriteAttemptedError(RuntimeError):
    """Raised when code tries to execute a non-SELECT query."""


def _ensure_readonly(sql: str) -> None:
    """
    Inspect `sql` and raise WriteAttemptedError if it contains any mutation.
    Called before every query execution so buggy future code can never write.
    """
    if not _READONLY:
        return
    stripped = sql.strip().lstrip("(").lower()
    if not stripped.startswith("select"):
        raise WriteAttemptedError(
            f"Refused: bot is read-only. Attempted query: {sql[:120]}..."
        )
    for kw in _FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{kw}\b", stripped):
            raise WriteAttemptedError(
                f"Refused: query contains forbidden keyword '{kw}'."
            )


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------
def _mysql_conn():
    """Open a new MySQL connection using .env credentials."""
    import mysql.connector
    return mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
    )


def _sqlite_conn():
    """Open a SQLite connection with Row factory (column-name access)."""
    conn = sqlite3.connect(_SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_sqlite_seeded():
    """Auto-seed the SQLite DB if it's missing or empty."""
    need_seed = not Path(_SQLITE_PATH).exists()
    if not need_seed:
        with _sqlite_conn() as c:
            try:
                row = c.execute("SELECT COUNT(*) AS n FROM products").fetchone()
                if row["n"] == 0:
                    need_seed = True
            except sqlite3.OperationalError:
                need_seed = True
    if need_seed:
        from seed_db import seed
        seed(_SQLITE_PATH)


# ---------------------------------------------------------------------------
# Row normalisation
# ---------------------------------------------------------------------------
def _row_to_dict(row) -> dict:
    """
    Convert a DB row to a plain dict and add a `price_baht` convenience field.
    The raw DB stores prices in integer cents (99168 = ฿991.68).
    """
    d = dict(row)
    if "price_cents" in d and d["price_cents"] is not None:
        d["price_baht"] = round(d["price_cents"] / 100, 2)
    return d


# ---------------------------------------------------------------------------
# Product search — public entry point
# ---------------------------------------------------------------------------
def search_products(intent_result: dict, limit: int = 3) -> list[dict]:
    """
    Dispatch to the active backend (MySQL or SQLite) and return up to `limit`
    products that match the intent, budget, and category in `intent_result`.
    """
    intent   = intent_result.get("intent")
    budget   = intent_result.get("budget")
    tokens   = intent_result.get("tokens", [])
    category = intent_result.get("category")   # e.g. "clothing", "sports"

    if _USE_MYSQL:
        return _search_mysql(intent, budget, tokens, limit, category)
    _ensure_sqlite_seeded()
    return _search_sqlite(intent, budget, tokens, limit, category)


# ---------------------------------------------------------------------------
# SQLite backend (dev / testing)
# ---------------------------------------------------------------------------
def _search_sqlite(intent, budget, tokens, limit, category=None):
    """
    Build and run a parameterised SELECT against the local SQLite test DB.
    The seeded schema uses a `tags` column (comma-separated) instead of
    the MySQL `keywords` JSON array, so filters are slightly different.
    """
    sql = "SELECT * FROM products WHERE 1=1"
    params: list = []

    if intent == "gift":
        sql += " AND tags LIKE ?"
        params.append("%gift%")
    elif intent == "best":
        pass  # no rating threshold — sort order handles it
    elif intent == "category" and category:
        # SQLite seed data uses tags, not a `type` column.
        sql += " AND tags LIKE ?"
        params.append(f"%{category}%")
    elif intent == "product_search":
        # Search product names for each meaningful token (length > 3).
        meaningful = [t for t in tokens if len(t) > 3 and t not in ("abona",)]
        if meaningful:
            sql += " AND (" + " OR ".join(["name LIKE ?"] * len(meaningful)) + ")"
            params.extend([f"%{t}%" for t in meaningful])

    if budget is not None:
        sql += " AND price_cents <= ?"
        params.append(int(budget * 100))  # convert ฿ to cents

    sql += " ORDER BY stars DESC, review_count DESC LIMIT ?"
    params.append(limit)

    _ensure_readonly(sql)
    with _sqlite_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# MySQL backend (production)
# ---------------------------------------------------------------------------
def _search_mysql(intent, budget, tokens, limit, category=None):
    """
    Build and run a parameterised SELECT against the live abona_shop MySQL DB.

    Column aliasing keeps the responder and tests working without changes:
      rating_count → review_count
      keywords     → tags

    The `is_active = 1` filter ensures discontinued products are never shown.
    All products start with stars = 0.00 until reviews are submitted, so the
    'best' intent skips the star filter and relies on rating_count ordering.
    """
    sql = (
        "SELECT id, name, image, price_cents, stars, type, description, "
        "       rating_count AS review_count, "   # alias for responder compatibility
        "       keywords     AS tags "            # alias for responder compatibility
        "FROM products "
        "WHERE is_active = 1 "
    )
    params: list = []

    if intent == "gift":
        # keywords is a JSON array like '["gift","home","fragrance"]'
        sql += " AND keywords LIKE %s"
        params.append("%gift%")
    elif intent == "best":
        # No star filter — all products start at 0 stars.
        # Sorted by rating_count DESC so most-reviewed items surface first.
        pass
    elif intent == "category":
        # Filter by the `type` column (clothing / kitchen / sports / other).
        if category:
            sql += " AND type = %s"
            params.append(category)
    elif intent == "product_search":
        # Free-text search: look for meaningful tokens in name and keywords.
        # Skip short words and the bot trigger word "abona".
        meaningful = [t for t in tokens if len(t) > 3 and t not in ("abona",)]
        if meaningful:
            clauses = []
            for t in meaningful:
                clauses.append("(name LIKE %s OR keywords LIKE %s)")
                params.extend([f"%{t}%", f"%{t}%"])
            sql += " AND (" + " OR ".join(clauses) + ")"

    if budget is not None:
        sql += " AND price_cents <= %s"
        params.append(int(budget * 100))

    sql += " ORDER BY stars DESC, rating_count DESC LIMIT %s"
    params.append(limit)

    _ensure_readonly(sql)
    conn = _mysql_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params)
        rows = cur.fetchall()

        # Fallback for gift intent: if no products are tagged "gift", return
        # the top active products anyway so the bot never comes back empty.
        if not rows and intent == "gift":
            fallback = (
                "SELECT id, name, image, price_cents, stars, type, description, "
                "       rating_count AS review_count, keywords AS tags "
                "FROM products WHERE is_active = 1 "
                "ORDER BY stars DESC, rating_count DESC LIMIT %s"
            )
            _ensure_readonly(fallback)
            cur.execute(fallback, [limit])
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Order lookup
# ---------------------------------------------------------------------------
def lookup_order(order_ref: str) -> Optional[dict]:
    """
    Look up a single order by its UUID primary key.

    Only available in MySQL mode — the SQLite test DB has no orders table.
    Returns None if the order is not found or the backend is SQLite.

    The caller (main.py) only calls this function when the analyzer has
    already confirmed a UUID is present in the message.
    """
    if not _USE_MYSQL:
        return None   # SQLite test DB doesn't have real orders

    sql = (
        "SELECT id, status, total_cents, subtotal_cents, shipping_cents, "
        "       discount_cents, tax_cents, "
        "       shipping_name, shipping_city, shipping_country, created_at "
        "FROM orders WHERE id = %s LIMIT 1"
    )
    _ensure_readonly(sql)
    conn = _mysql_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, [order_ref])
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return None
    row["total_baht"] = round(row["total_cents"] / 100, 2)
    return dict(row)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------
def backend_name() -> str:
    """Return 'mysql' or 'sqlite' — used by the health endpoint."""
    return "mysql" if _USE_MYSQL else "sqlite"


def is_readonly() -> bool:
    """Return True if the readonly guard is active."""
    return _READONLY

"""
Seeds the SQLite test database with sample products.

Run directly:   python seed_db.py
Or import and call seed(path) from db.py.
"""

import sqlite3
from pathlib import Path

SAMPLE_PRODUCTS = [
    # name, description, price_cents, stars, review_count, image, tags
    ("Rose Eau de Parfum",        "Floral rose fragrance with a musky base note.",       120000, 4.8, 124, "🌸", "gift,fragrance,popular,bestseller"),
    ("Silk Body Lotion Set",      "3-piece silk-infused lotion gift box.",                89000, 4.5,  89, "💆", "gift,body_care,popular"),
    ("Jasmine Candle Collection", "Three hand-poured jasmine candles.",                   75000, 4.7,  56, "🕯", "gift,candle,home"),
    ("Lavender Pillow Mist",      "Calming lavender spray for bedtime.",                  45000, 4.6,  78, "💤", "bath,home,affordable"),
    ("Himalayan Bath Salts",      "Pink salts with essential oils, 500 g.",               35000, 4.4,  42, "🛁", "bath,affordable"),
    ("Shea Butter Balm",          "Thick shea balm for dry skin.",                        39000, 4.5,  61, "🧴", "body_care,affordable"),
    ("Oud & Amber Perfume",       "Warm, woody luxury fragrance.",                       180000, 4.9, 203, "✨", "fragrance,popular,bestseller,luxury"),
    ("Jasmine Body Oil",          "Light jasmine-scented nourishing oil.",                68000, 4.3,  34, "💧", "body_care,fragrance"),
    ("Gift Set — Spa Day",        "Candle + salts + lotion bundled gift box.",           145000, 4.7, 112, "🎁", "gift,bestseller,bath,body_care"),
    ("Mini Rose Perfume",         "Purse-sized rose perfume, 10 ml.",                     55000, 4.4,  88, "🌸", "fragrance,gift,affordable"),
    ("Vanilla Soy Candle",        "Warm vanilla, 40-hour burn time.",                     42000, 4.6,  66, "🕯", "candle,home,affordable"),
    ("Honey Face Serum",          "Hydrating honey-extract serum.",                       99000, 4.5,  71, "🍯", "skincare,popular"),
    ("Lotus Bath Bombs (6-pack)", "Six lotus-scented fizzy bath bombs.",                  29000, 4.3,  54, "🪷", "bath,affordable,gift"),
    ("Sandalwood Incense",        "Authentic Thai sandalwood sticks, 30-pack.",           22000, 4.2,  38, "🪵", "home,affordable"),
    ("Premium Silk Scarf",        "Hand-dyed silk, 180 × 70 cm.",                        230000, 4.8,  47, "🧣", "gift,luxury,accessories"),
]


def seed(db_path: str) -> None:
    """Create schema and insert sample products. Idempotent."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT    NOT NULL,
                description   TEXT,
                price_cents   INTEGER NOT NULL,
                stars         REAL,
                review_count  INTEGER,
                image         TEXT,
                tags          TEXT
            )
        """)
        # Only insert if table is empty (idempotent).
        cur = conn.execute("SELECT COUNT(*) FROM products")
        if cur.fetchone()[0] == 0:
            conn.executemany(
                "INSERT INTO products (name, description, price_cents, stars, review_count, image, tags) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                SAMPLE_PRODUCTS,
            )
        conn.commit()
        print(f"[seed_db] Seeded {len(SAMPLE_PRODUCTS)} products into {db_path}")
    finally:
        conn.close()


if __name__ == "__main__":
    from pathlib import Path as _P
    default = str(_P(__file__).resolve().parent / "abona_test.db")
    seed(default)

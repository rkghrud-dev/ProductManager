import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'products.db')


def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS products (
            product_code TEXT PRIMARY KEY,
            cafe24_code TEXT,
            supplier_code TEXT,
            product_seq TEXT,
            option_code TEXT,
            sku_group TEXT,
            product_name TEXT,
            price REAL,
            image_url TEXT,
            display_status TEXT,
            sale_status TEXT,
            naver_status TEXT DEFAULT '신규',
            naver_product_id TEXT,
            is_listed INTEGER DEFAULT 0,
            listed_date TEXT,
            listing_batch_id INTEGER,
            is_naver_duplicate INTEGER DEFAULT 0,
            raw_data TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_supplier ON products(supplier_code);
        CREATE INDEX IF NOT EXISTS idx_sku_group ON products(sku_group);
        CREATE INDEX IF NOT EXISTS idx_is_listed ON products(is_listed);
        CREATE INDEX IF NOT EXISTS idx_naver_status ON products(naver_status);
        CREATE INDEX IF NOT EXISTS idx_product_seq ON products(product_seq);

        CREATE TABLE IF NOT EXISTS listing_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_date TEXT DEFAULT (datetime('now','localtime')),
            suppliers TEXT,
            sort_order TEXT,
            count_per_supplier INTEGER,
            total_rows INTEGER,
            total_skus INTEGER,
            file_name TEXT,
            is_cancelled INTEGER DEFAULT 0,
            cancelled_date TEXT,
            sku_list TEXT
        );

        CREATE TABLE IF NOT EXISTS upload_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            upload_date TEXT DEFAULT (datetime('now','localtime')),
            file_name TEXT,
            total_count INTEGER,
            new_count INTEGER,
            updated_count INTEGER,
            skipped_count INTEGER
        );

        CREATE TABLE IF NOT EXISTS column_headers (
            id INTEGER PRIMARY KEY DEFAULT 1,
            headers TEXT
        );

        CREATE TABLE IF NOT EXISTS naver_duplicates (
            gs_code TEXT PRIMARY KEY,
            naver_count INTEGER,
            naver_product_ids TEXT
        );
    ''')
    conn.commit()
    conn.close()


def upsert_products(products, headers, naver_dup_codes):
    conn = get_db()
    new_count = 0
    updated_count = 0
    skipped_count = 0

    if headers:
        conn.execute(
            "INSERT OR REPLACE INTO column_headers (id, headers) VALUES (1, ?)",
            (json.dumps(headers, ensure_ascii=False),)
        )

    for code in naver_dup_codes:
        conn.execute(
            "INSERT OR REPLACE INTO naver_duplicates (gs_code, naver_count) VALUES (?, 1)",
            (code,)
        )

    naver_dup_groups = set()
    for code in naver_dup_codes:
        if len(code) > 1 and code[-1].isalpha():
            naver_dup_groups.add(code[:-1])
        else:
            naver_dup_groups.add(code)

    for p in products:
        existing = conn.execute(
            "SELECT product_code, is_listed FROM products WHERE product_code = ?",
            (p['product_code'],)
        ).fetchone()

        is_naver_dup = 1 if p['sku_group'] in naver_dup_groups else 0

        if existing:
            if existing['is_listed']:
                skipped_count += 1
                continue
            conn.execute('''
                UPDATE products SET
                    cafe24_code=?, supplier_code=?, product_seq=?, option_code=?,
                    sku_group=?, product_name=?, price=?, image_url=?,
                    display_status=?, sale_status=?, naver_status=?,
                    naver_product_id=?, is_naver_duplicate=?, raw_data=?,
                    updated_at=datetime('now','localtime')
                WHERE product_code=?
            ''', (
                p['cafe24_code'], p['supplier_code'], p['product_seq'],
                p['option_code'], p['sku_group'], p['product_name'],
                p['price'], p['image_url'], p['display_status'],
                p['sale_status'], p['naver_status'], p['naver_product_id'],
                is_naver_dup, json.dumps(p['raw_data'], ensure_ascii=False),
                p['product_code']
            ))
            updated_count += 1
        else:
            conn.execute('''
                INSERT INTO products (
                    product_code, cafe24_code, supplier_code, product_seq,
                    option_code, sku_group, product_name, price, image_url,
                    display_status, sale_status, naver_status, naver_product_id,
                    is_naver_duplicate, raw_data
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                p['product_code'], p['cafe24_code'], p['supplier_code'],
                p['product_seq'], p['option_code'], p['sku_group'],
                p['product_name'], p['price'], p['image_url'],
                p['display_status'], p['sale_status'], p['naver_status'],
                p['naver_product_id'], is_naver_dup,
                json.dumps(p['raw_data'], ensure_ascii=False)
            ))
            new_count += 1

    conn.commit()
    conn.close()
    return new_count, updated_count, skipped_count


def get_suppliers():
    conn = get_db()
    rows = conn.execute('''
        SELECT
            supplier_code,
            COUNT(DISTINCT sku_group) as total_skus,
            COUNT(DISTINCT CASE WHEN is_listed=0 AND naver_status='신규'
                AND is_naver_duplicate=0 THEN sku_group END) as available_skus,
            COUNT(DISTINCT CASE WHEN is_listed=1 THEN sku_group END) as listed_skus
        FROM products
        WHERE sale_status='Y'
        GROUP BY supplier_code
        ORDER BY supplier_code
    ''').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_available_products(suppliers, sort_order, count_per_supplier):
    conn = get_db()
    all_skus = []

    order_clause = {
        'latest': 'product_seq DESC',
        'oldest': 'product_seq ASC',
        'random': 'RANDOM()'
    }.get(sort_order, 'product_seq DESC')

    for supplier in suppliers:
        sku_groups = conn.execute(f'''
            SELECT DISTINCT sku_group
            FROM products
            WHERE supplier_code=?
                AND is_listed=0
                AND naver_status='신규'
                AND is_naver_duplicate=0
                AND sale_status='Y'
            ORDER BY {order_clause}
            LIMIT ?
        ''', (supplier, count_per_supplier)).fetchall()

        all_skus.extend([r['sku_group'] for r in sku_groups])

    if not all_skus:
        conn.close()
        return [], []

    placeholders = ','.join(['?'] * len(all_skus))
    products = conn.execute(f'''
        SELECT * FROM products
        WHERE sku_group IN ({placeholders})
        ORDER BY sku_group, option_code
    ''', all_skus).fetchall()

    conn.close()
    return [dict(p) for p in products], all_skus


def mark_as_listed(sku_groups, batch_id):
    conn = get_db()
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for sku in sku_groups:
        conn.execute('''
            UPDATE products
            SET is_listed=1, listed_date=?, listing_batch_id=?
            WHERE sku_group=?
        ''', (now, batch_id, sku))
    conn.commit()
    conn.close()


def cancel_listing(batch_id):
    conn = get_db()
    conn.execute('''
        UPDATE products
        SET is_listed=0, listed_date=NULL, listing_batch_id=NULL
        WHERE listing_batch_id=?
    ''', (batch_id,))
    conn.execute('''
        UPDATE listing_history
        SET is_cancelled=1, cancelled_date=datetime('now','localtime')
        WHERE id=?
    ''', (batch_id,))
    conn.commit()
    conn.close()


def save_listing_history(suppliers, sort_order, count_per_supplier,
                         total_rows, total_skus, file_name, sku_list):
    conn = get_db()
    cursor = conn.execute('''
        INSERT INTO listing_history
            (suppliers, sort_order, count_per_supplier, total_rows,
             total_skus, file_name, sku_list)
        VALUES (?,?,?,?,?,?,?)
    ''', (
        json.dumps(suppliers, ensure_ascii=False), sort_order,
        count_per_supplier, total_rows, total_skus, file_name,
        json.dumps(sku_list, ensure_ascii=False)
    ))
    batch_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return batch_id


def save_upload_history(file_name, total, new, updated, skipped):
    conn = get_db()
    conn.execute('''
        INSERT INTO upload_history (file_name, total_count, new_count,
                                    updated_count, skipped_count)
        VALUES (?,?,?,?,?)
    ''', (file_name, total, new, updated, skipped))
    conn.commit()
    conn.close()


def get_listing_history():
    conn = get_db()
    rows = conn.execute('''
        SELECT * FROM listing_history
        ORDER BY batch_date DESC
    ''').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_listing_detail(batch_id):
    conn = get_db()
    history = conn.execute(
        "SELECT * FROM listing_history WHERE id=?", (batch_id,)
    ).fetchone()
    if not history:
        conn.close()
        return None, []

    sku_list = json.loads(history['sku_list'])
    if not sku_list:
        conn.close()
        return dict(history), []

    placeholders = ','.join(['?'] * len(sku_list))
    products = conn.execute(f'''
        SELECT product_code, sku_group, product_name, price,
               supplier_code, option_code, image_url
        FROM products
        WHERE sku_group IN ({placeholders})
        ORDER BY sku_group, option_code
    ''', sku_list).fetchall()

    conn.close()
    return dict(history), [dict(p) for p in products]


def get_column_headers():
    conn = get_db()
    row = conn.execute("SELECT headers FROM column_headers WHERE id=1").fetchone()
    conn.close()
    if row:
        return json.loads(row['headers'])
    return None


def get_products_raw_data(sku_groups):
    conn = get_db()
    placeholders = ','.join(['?'] * len(sku_groups))
    rows = conn.execute(f'''
        SELECT raw_data FROM products
        WHERE sku_group IN ({placeholders})
        ORDER BY sku_group, option_code
    ''', sku_groups).fetchall()
    conn.close()
    return [json.loads(r['raw_data']) for r in rows]


def get_dashboard_data():
    conn = get_db()

    overall = conn.execute('''
        SELECT
            COUNT(DISTINCT sku_group) as total_skus,
            COUNT(DISTINCT CASE WHEN is_listed=1 THEN sku_group END) as listed_skus,
            COUNT(*) as total_products
        FROM products WHERE sale_status='Y'
    ''').fetchone()

    by_supplier = conn.execute('''
        SELECT
            supplier_code,
            COUNT(DISTINCT sku_group) as total_skus,
            COUNT(DISTINCT CASE WHEN is_listed=1 THEN sku_group END) as listed_skus,
            COUNT(DISTINCT CASE WHEN naver_status='이미올림' THEN sku_group END) as naver_skus,
            COUNT(DISTINCT CASE WHEN is_naver_duplicate=1 THEN sku_group END) as dup_skus
        FROM products WHERE sale_status='Y'
        GROUP BY supplier_code
        ORDER BY supplier_code
    ''').fetchall()

    monthly = conn.execute('''
        SELECT
            strftime('%Y-%m', batch_date) as month,
            SUM(total_skus) as skus,
            SUM(total_rows) as rows,
            COUNT(*) as batches
        FROM listing_history
        WHERE is_cancelled=0
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
    ''').fetchall()

    recent = conn.execute('''
        SELECT * FROM listing_history
        WHERE is_cancelled=0
        ORDER BY batch_date DESC
        LIMIT 10
    ''').fetchall()

    upload_stats = conn.execute('''
        SELECT * FROM upload_history
        ORDER BY upload_date DESC
        LIMIT 5
    ''').fetchall()

    conn.close()
    return {
        'overall': dict(overall) if overall else {},
        'by_supplier': [dict(r) for r in by_supplier],
        'monthly': [dict(r) for r in monthly],
        'recent': [dict(r) for r in recent],
        'upload_stats': [dict(r) for r in upload_stats]
    }

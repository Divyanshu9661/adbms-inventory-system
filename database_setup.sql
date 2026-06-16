-- ====================================================================
-- ADBMS INVENTORY MANAGEMENT SYSTEM - COMPLETE SQL DATABASE SCRIPT
-- Contains: Tables, Constraints, Indexes, Views, Triggers & Seed Data
-- Target Engine: SQLite (SQL-compliant)
-- ====================================================================

-- Enable Foreign Key support in SQLite (MUST run this pragma)
PRAGMA foreign_keys = ON;

-- ====================================================================
-- 1. DROP EXISTING DATABASE SCHEMAS (For Clean Re-run)
-- ====================================================================
DROP VIEW IF EXISTS v_low_stock_alerts;
DROP VIEW IF EXISTS v_supplier_performance;
DROP VIEW IF EXISTS v_stock_valuation;

DROP TRIGGER IF EXISTS trg_update_stock_on_transaction;
DROP TRIGGER IF EXISTS trg_prevent_negative_stock;
DROP TRIGGER IF EXISTS trg_audit_products_update;
DROP TRIGGER IF EXISTS trg_audit_purchase_orders_update;
DROP TRIGGER IF EXISTS trg_prevent_po_item_insert_on_processed_po;

DROP TABLE IF EXISTS inventory_audit_log;
DROP TABLE IF EXISTS stock_transactions;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS suppliers;

-- ====================================================================
-- 2. TABLE DDL SCHEMAS (1NF, 2NF, 3NF Normalized Structure)
-- ====================================================================

-- Table A: Suppliers Directory (3NF)
CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table B: Product Catalog (3NF)
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    price REAL NOT NULL CHECK(price >= 0),
    quantity_in_stock INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK(reorder_level >= 0),
    supplier_id INTEGER,
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

-- Table C: Purchase Orders Header (3NF)
CREATE TABLE purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    expected_date DATETIME,
    delivery_date DATETIME,
    total_amount REAL DEFAULT 0.0 CHECK(total_amount >= 0),
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

-- Table D: Purchase Order Line Items (3NF - Resolves Repeating Groups)
CREATE TABLE purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL CHECK(unit_price >= 0),
    received_quantity INTEGER DEFAULT 0 CHECK(received_quantity >= 0),
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- Table E: Inventory Ledger Transactions (3NF)
CREATE TABLE stock_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('IN', 'OUT', 'ADJUSTMENT')),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    reference_id TEXT, -- e.g. 'PO-1', 'MANUAL'
    notes TEXT,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Table F: Automated Audit Trails (3NF)
CREATE TABLE inventory_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('INSERT', 'UPDATE', 'DELETE')),
    record_id INTEGER NOT NULL,
    old_values TEXT, -- JSON string representation
    new_values TEXT, -- JSON string representation
    changed_by TEXT DEFAULT 'SYSTEM',
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- 3. DATABASE INDEXES (ADBMS Query Optimizer Support)
-- ====================================================================

-- Unique index to prevent duplicate SKU codes & optimize O(1) searches
CREATE UNIQUE INDEX idx_products_sku ON products(sku);

-- Composite index on transactions ledger to optimize datetime history checks
CREATE INDEX idx_stock_transactions_prod_date ON stock_transactions(product_id, transaction_date);

-- Composite index on POs to speed up supplier filtering
CREATE INDEX idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);

-- ====================================================================
-- 4. DATABASE VIEWS (Virtual Tables for Live Analytics)
-- ====================================================================

-- View 1: Low Stock warning alerts joined with Supplier contact info
CREATE VIEW v_low_stock_alerts AS
SELECT 
    p.id AS product_id,
    p.sku,
    p.name AS product_name,
    p.quantity_in_stock,
    p.reorder_level,
    p.category,
    ((p.reorder_level * 2) - p.quantity_in_stock) AS recommended_order_qty,
    s.id AS supplier_id,
    s.name AS supplier_name,
    s.email AS supplier_email
FROM products p
LEFT JOIN suppliers s ON p.supplier_id = s.id
WHERE p.quantity_in_stock <= p.reorder_level AND p.status = 'Active';

-- View 2: Supplier Profile Performance (lead times and fulfillment rates)
CREATE VIEW v_supplier_performance AS
SELECT 
    s.id AS supplier_id,
    s.name AS supplier_name,
    s.contact_name,
    s.email,
    COUNT(po.id) AS total_orders,
    COALESCE(SUM(po.total_amount), 0) AS total_spend,
    AVG(CASE WHEN po.status = 'DELIVERED' AND po.delivery_date IS NOT NULL THEN 
        (julianday(po.delivery_date) - julianday(po.order_date)) 
    END) AS avg_lead_time_days,
    (CAST(SUM(CASE WHEN po.status = 'DELIVERED' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(po.id), 0)) * 100 AS fulfillment_rate
FROM suppliers s
LEFT JOIN purchase_orders po ON s.id = po.supplier_id
GROUP BY s.id;

-- View 3: Warehouse inventory valuation breakdown by category
CREATE VIEW v_stock_valuation AS
SELECT 
    category,
    COUNT(id) AS product_count,
    SUM(quantity_in_stock) AS total_items,
    SUM(quantity_in_stock * price) AS total_valuation
FROM products
WHERE status = 'Active'
GROUP BY category;

-- ====================================================================
-- 5. DATABASE TRIGGERS (Automated Business Logic & Constraints)
-- ====================================================================

-- Trigger 1: Automatically adjust stock quantity when a transaction occurs
CREATE TRIGGER trg_update_stock_on_transaction
AFTER INSERT ON stock_transactions
BEGIN
    UPDATE products
    SET quantity_in_stock = quantity_in_stock + (
        CASE 
            WHEN NEW.transaction_type = 'IN' THEN NEW.quantity
            WHEN NEW.transaction_type = 'OUT' THEN -NEW.quantity
            WHEN NEW.transaction_type = 'ADJUSTMENT' THEN NEW.quantity
            ELSE 0
        END
    )
    WHERE id = NEW.product_id;
END;

-- Trigger 2: Prevent stock levels from dropping below 0 (BEFORE UPDATE)
CREATE TRIGGER trg_prevent_negative_stock
BEFORE UPDATE ON products
FOR EACH ROW
WHEN NEW.quantity_in_stock < 0
BEGIN
    SELECT RAISE(ABORT, 'DBMS Constraint Error: Quantity in stock cannot fall below 0.');
END;

-- Trigger 3: Audit trail logger when product quantity or price is modified
CREATE TRIGGER trg_audit_products_update
AFTER UPDATE ON products
FOR EACH ROW
WHEN OLD.quantity_in_stock <> NEW.quantity_in_stock OR OLD.price <> NEW.price
BEGIN
    INSERT INTO inventory_audit_log (table_name, action_type, record_id, old_values, new_values, changed_by)
    VALUES (
        'products',
        'UPDATE',
        NEW.id,
        json_object('quantity_in_stock', OLD.quantity_in_stock, 'price', OLD.price),
        json_object('quantity_in_stock', NEW.quantity_in_stock, 'price', NEW.price),
        'DB_TRIGGER_PRODUCTS'
    );
END;

-- Trigger 4: Audit trail logger for changes in purchase order status
CREATE TRIGGER trg_audit_purchase_orders_update
AFTER UPDATE ON purchase_orders
FOR EACH ROW
WHEN OLD.status <> NEW.status
BEGIN
    INSERT INTO inventory_audit_log (table_name, action_type, record_id, old_values, new_values, changed_by)
    VALUES (
        'purchase_orders',
        'UPDATE',
        NEW.id,
        json_object('status', OLD.status),
        json_object('status', NEW.status),
        'DB_TRIGGER_ORDERS'
    );
END;

-- Trigger 5: Prevent adding line items to non-pending Purchase Orders (BEFORE INSERT)
CREATE TRIGGER trg_prevent_po_item_insert_on_processed_po
BEFORE INSERT ON purchase_order_items
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'DBMS Constraint Error: Cannot add items to a purchase order that is not PENDING.')
    WHERE (SELECT status FROM purchase_orders WHERE id = NEW.order_id) <> 'PENDING';
END;

-- ====================================================================
-- 6. MOCK SEED DATA (Explicit Transaction-Safe Seed Commands)
-- ====================================================================
BEGIN TRANSACTION;

-- A: Insert Suppliers
INSERT INTO suppliers (id, name, contact_name, email, phone, address, status) VALUES 
(1, 'Quantum Electronics', 'Alice Chen', 'sales@quantum.com', '+1-555-0199', 'Silicon Valley, CA', 'Active'),
(2, 'Office Depot Logistics', 'Robert Jenkins', 'orders@officedepot.com', '+1-800-555-0122', 'Chicago, IL', 'Active'),
(3, 'Apex Packaging Corp', 'Sarah Smith', 'sarah@apexpack.com', '+1-312-555-0144', 'Detroit, MI', 'Active');

-- B: Insert Products (Stock initially 0)
INSERT INTO products (id, sku, name, description, category, price, quantity_in_stock, reorder_level, supplier_id, status) VALUES 
(1, 'ELEC-LAP-001', 'EliteBook Pro 15', 'High performance laptop for developers', 'Electronics', 1200.0, 0, 5, 1, 'Active'),
(2, 'ELEC-MOU-002', 'Wireless Ergonomic Mouse', 'Rechargeable vertical mouse', 'Electronics', 45.0, 0, 15, 1, 'Active'),
(3, 'ELEC-KEY-003', 'Mechanical Keyboard RGB', 'Cherry MX Blue gaming keyboard', 'Electronics', 99.0, 0, 10, 1, 'Active'),
(4, 'OFF-PAP-010', 'A4 Copier Paper (Ream)', '80gsm high brightness paper', 'Office Supplies', 6.5, 0, 50, 2, 'Active'),
(5, 'OFF-PEN-011', 'Gel Pen Black (Box of 12)', 'Smooth fine-point black pens', 'Office Supplies', 12.0, 0, 20, 2, 'Active'),
(6, 'PKG-BOX-101', 'Cardboard Box Medium', '12x12x12 double wall corrugated box', 'Packaging', 1.8, 0, 100, 3, 'Active'),
(7, 'PKG-TAP-102', 'Heavy Duty Shipping Tape', 'Clear packing tape 2-inch width', 'Packaging', 3.2, 0, 40, 3, 'Active');

-- C: Insert Transactions (Fires Trigger 1 to adjust stock)
INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES 
(1, 'IN', 20, 'INITIAL-STOCK', 'Warehouse opening stock'),
(2, 'IN', 50, 'INITIAL-STOCK', 'Warehouse opening stock'),
(3, 'IN', 30, 'INITIAL-STOCK', 'Warehouse opening stock'),
(4, 'IN', 200, 'INITIAL-STOCK', 'Initial logistics purchase'),
(5, 'IN', 10, 'INITIAL-STOCK', 'Initial low quantity pen seed'),
(6, 'IN', 500, 'INITIAL-STOCK', 'Initial box stock'),
(7, 'IN', 15, 'INITIAL-STOCK', 'Initial tape stock'),
(1, 'OUT', 3, 'SALE-1001', 'Fulfillment for order #1001'),
(2, 'OUT', 10, 'SALE-1002', 'Customer shipment #1002'),
(4, 'OUT', 40, 'OFFICE-ADJUST', 'Consumed internal use');

-- D: Insert Purchase Orders (PENDING first to comply with Trigger 5)
INSERT INTO purchase_orders (id, supplier_id, order_date, expected_date, total_amount, status) VALUES 
(1, 1, datetime('now', '-10 day'), datetime('now', '-6 day'), 2400.0, 'PENDING'),
(2, 2, datetime('now', '-2 day'), datetime('now', '+5 day'), 195.0, 'PENDING'),
(3, 3, datetime('now', '-3 day'), datetime('now', '+1 day'), 1280.0, 'PENDING');

-- E: Insert Purchase Order Items
INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES 
(1, 1, 2, 1200.0, 2),
(2, 4, 10, 6.5, 0),
(2, 5, 10, 12.0, 0),
(3, 7, 400, 3.2, 0);

-- F: Update status of processed Purchase Orders (Fires audit Triggers)
UPDATE purchase_orders SET status = 'DELIVERED', delivery_date = datetime('now', '-5 day') WHERE id = 1;
UPDATE purchase_orders SET status = 'SHIPPED' WHERE id = 3;

-- G: Log incoming stock from Delivered PO 1 (Fires stock trigger)
INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes, transaction_date) VALUES 
(1, 'IN', 2, 'PO-1', 'Fulfillment from PO', datetime('now', '-5 day'));

COMMIT;

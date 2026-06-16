import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'inventory.db');

// Enable verbose SQLite logging if needed
const sqlite = sqlite3.verbose();

// Helper to check if database file exists
const dbExists = fs.existsSync(dbPath);

export const db = new sqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);
    // CRITICAL ADBMS STEP: Enable Foreign Keys in SQLite
    db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
      if (pragmaErr) {
        console.error('Error enabling foreign keys', pragmaErr.message);
      } else {
        console.log('Foreign key support enabled.');
      }
    });
  }
});

// Wrap DB run/get/all in promises for easier async/await usage
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this); // returns 'this' which contains lastID and changes
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Execute multiple SQL statements separated by semicolons (for DDL)
export const dbExec = (sql) => {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Initialize database schema, triggers, views, and indexes
export async function initializeDatabase(forceReset = false) {
  if (forceReset) {
    console.log('Force resetting database... dropping tables, views, and triggers.');
    const dropQueries = [
      'DROP VIEW IF EXISTS v_low_stock_alerts',
      'DROP VIEW IF EXISTS v_supplier_performance',
      'DROP VIEW IF EXISTS v_stock_valuation',
      'DROP TRIGGER IF EXISTS trg_update_stock_on_transaction',
      'DROP TRIGGER IF EXISTS trg_prevent_negative_stock',
      'DROP TRIGGER IF EXISTS trg_audit_products_update',
      'DROP TRIGGER IF EXISTS trg_audit_purchase_orders_update',
      'DROP TABLE IF EXISTS inventory_audit_log',
      'DROP TABLE IF EXISTS stock_transactions',
      'DROP TABLE IF EXISTS purchase_order_items',
      'DROP TABLE IF EXISTS purchase_orders',
      'DROP TABLE IF EXISTS products',
      'DROP TABLE IF EXISTS suppliers'
    ];
    for (const query of dropQueries) {
      try {
        await dbRun(query);
      } catch (err) {
        console.warn(`Warning during reset query "${query}":`, err.message);
      }
    }
  }

  // Create Tables
  const ddlSchema = `
    -- 1. Suppliers Table
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Products Table
    CREATE TABLE IF NOT EXISTS products (
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

    -- 3. Purchase Orders Table
    CREATE TABLE IF NOT EXISTS purchase_orders (
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

    -- 4. Purchase Order Items Table
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      received_quantity INTEGER DEFAULT 0 CHECK(received_quantity >= 0),
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    -- 5. Stock Transactions Table (Ledger)
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('IN', 'OUT', 'ADJUSTMENT')),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      reference_id TEXT, -- e.g., 'PO-5', 'SALE-101', 'MANUAL'
      notes TEXT,
      transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    -- 6. Database Audit Log Table (For tracking updates)
    CREATE TABLE IF NOT EXISTS inventory_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('INSERT', 'UPDATE', 'DELETE')),
      record_id INTEGER NOT NULL,
      old_values TEXT, -- JSON string representation
      new_values TEXT, -- JSON string representation
      changed_by TEXT DEFAULT 'SYSTEM',
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  console.log('Creating schemas and tables...');
  await dbExec(ddlSchema);

  // Create Indexes (ADBMS Feature)
  const indexSchema = `
    -- Index on SKU for quick product searching
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

    -- Composite Index on stock transactions for fast stock movement tracking
    CREATE INDEX IF NOT EXISTS idx_stock_transactions_prod_date ON stock_transactions(product_id, transaction_date);

    -- Index on POs for querying supplier history and filtering by status
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);
  `;

  console.log('Creating database indexes...');
  await dbExec(indexSchema);

  // Create Views (ADBMS Feature)
  const viewsSchema = `
    -- 1. View for low stock alert products
    CREATE VIEW IF NOT EXISTS v_low_stock_alerts AS
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

    -- 2. View for supplier profiling and metrics
    CREATE VIEW IF NOT EXISTS v_supplier_performance AS
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

    -- 3. View for category-wise inventory valuation
    CREATE VIEW IF NOT EXISTS v_stock_valuation AS
    SELECT 
      category,
      COUNT(id) AS product_count,
      SUM(quantity_in_stock) AS total_items,
      SUM(quantity_in_stock * price) AS total_valuation
    FROM products
    WHERE status = 'Active'
    GROUP BY category;
  `;

  console.log('Creating database views...');
  await dbExec(viewsSchema);

  // Create Triggers (ADBMS Feature)
  const triggersSchema = `
    -- 1. Trigger to automatically adjust stock quantity when a stock transaction occurs
    CREATE TRIGGER IF NOT EXISTS trg_update_stock_on_transaction
    AFTER INSERT ON stock_transactions
    BEGIN
      UPDATE products
      SET quantity_in_stock = quantity_in_stock + (
        CASE 
          WHEN NEW.transaction_type = 'IN' THEN NEW.quantity
          WHEN NEW.transaction_type = 'OUT' THEN -NEW.quantity
          WHEN NEW.transaction_type = 'ADJUSTMENT' THEN NEW.quantity -- can be negative or positive depending on entry
          ELSE 0
        END
      )
      WHERE id = NEW.product_id;
    END;

    -- 2. Trigger to prevent negative stock values (BEFORE UPDATE)
    CREATE TRIGGER IF NOT EXISTS trg_prevent_negative_stock
    BEFORE UPDATE ON products
    FOR EACH ROW
    WHEN NEW.quantity_in_stock < 0
    BEGIN
      SELECT RAISE(ABORT, 'DBMS Constraint Error: Quantity in stock cannot fall below 0.');
    END;

    -- 3. Trigger to audit changes in product quantities and prices (AFTER UPDATE)
    CREATE TRIGGER IF NOT EXISTS trg_audit_products_update
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

    -- 4. Trigger to audit updates in purchase order status (AFTER UPDATE)
    CREATE TRIGGER IF NOT EXISTS trg_audit_purchase_orders_update
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

    -- 5. Trigger to prevent adding items to purchase orders that are not PENDING
    CREATE TRIGGER IF NOT EXISTS trg_prevent_po_item_insert_on_processed_po
    BEFORE INSERT ON purchase_order_items
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'DBMS Constraint Error: Cannot add items to a purchase order that is not PENDING.')
      WHERE (SELECT status FROM purchase_orders WHERE id = NEW.order_id) <> 'PENDING';
    END;
  `;

  console.log('Creating database triggers...');
  await dbExec(triggersSchema);

  // Seed data if DB is new
  const supplierCount = await dbGet('SELECT COUNT(*) AS count FROM suppliers');
  if (supplierCount.count === 0) {
    console.log('No existing data. Seeding mock dataset...');
    await seedDatabase();
  } else {
    console.log('Database already has data. Skipping seed.');
  }
}

// Transaction-safe Seeding Script
async function seedDatabase() {
  await dbRun('BEGIN TRANSACTION');
  try {
    // 1. Seed Suppliers
    const suppliers = [
      { name: 'Quantum Electronics', contact: 'Alice Chen', email: 'sales@quantum.com', phone: '+1-555-0199', address: 'Silicon Valley, CA' },
      { name: 'Office Depot Logistics', contact: 'Robert Jenkins', email: 'orders@officedepot.com', phone: '+1-800-555-0122', address: 'Chicago, IL' },
      { name: 'Apex Packaging Corp', contact: 'Sarah Smith', email: 'sarah@apexpack.com', phone: '+1-312-555-0144', address: 'Detroit, MI' }
    ];

    const supplierIds = [];
    for (const s of suppliers) {
      const result = await dbRun(
        'INSERT INTO suppliers (name, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?)',
        [s.name, s.contact, s.email, s.phone, s.address]
      );
      supplierIds.push(result.lastID);
    }

    // 2. Seed Products (Starts with 0 stock, we will adjust/transact)
    const products = [
      { sku: 'ELEC-LAP-001', name: 'EliteBook Pro 15', desc: 'High performance laptop for developers', cat: 'Electronics', price: 1200.0, reorder: 5, supplier_id: supplierIds[0] },
      { sku: 'ELEC-MOU-002', name: 'Wireless Ergonomic Mouse', desc: 'Rechargeable vertical mouse', cat: 'Electronics', price: 45.0, reorder: 15, supplier_id: supplierIds[0] },
      { sku: 'ELEC-KEY-003', name: 'Mechanical Keyboard RGB', desc: 'Cherry MX Blue gaming keyboard', cat: 'Electronics', price: 99.0, reorder: 10, supplier_id: supplierIds[0] },
      { sku: 'OFF-PAP-010', name: 'A4 Copier Paper (Ream)', desc: '80gsm high brightness paper', cat: 'Office Supplies', price: 6.5, reorder: 50, supplier_id: supplierIds[1] },
      { sku: 'OFF-PEN-011', name: 'Gel Pen Black (Box of 12)', desc: 'Smooth fine-point black pens', cat: 'Office Supplies', price: 12.0, reorder: 20, supplier_id: supplierIds[1] },
      { sku: 'PKG-BOX-101', name: 'Cardboard Box Medium', desc: '12x12x12 double wall corrugated box', cat: 'Packaging', price: 1.8, reorder: 100, supplier_id: supplierIds[2] },
      { sku: 'PKG-TAP-102', name: 'Heavy Duty Shipping Tape', desc: 'Clear packing tape 2-inch width', cat: 'Packaging', price: 3.2, reorder: 40, supplier_id: supplierIds[2] }
    ];

    const productIds = [];
    for (const p of products) {
      const result = await dbRun(
        'INSERT INTO products (sku, name, description, category, price, reorder_level, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.sku, p.name, p.desc, p.cat, p.price, p.reorder, p.supplier_id]
      );
      productIds.push(result.lastID);
    }

    // 3. Seed Stock Transactions (This will fire triggers to update products' QuantityInStock!)
    const transactions = [
      { product_id: productIds[0], type: 'IN', qty: 20, ref: 'INITIAL-STOCK', notes: 'Warehouse opening stock' },
      { product_id: productIds[1], type: 'IN', qty: 50, ref: 'INITIAL-STOCK', notes: 'Warehouse opening stock' },
      { product_id: productIds[2], type: 'IN', qty: 30, ref: 'INITIAL-STOCK', notes: 'Warehouse opening stock' },
      { product_id: productIds[3], type: 'IN', qty: 200, ref: 'INITIAL-STOCK', notes: 'Initial logistics purchase' },
      { product_id: productIds[4], type: 'IN', qty: 10, ref: 'INITIAL-STOCK', notes: 'Initial low quantity pen seed' }, // Low stock check (Reorder: 20)
      { product_id: productIds[5], type: 'IN', qty: 500, ref: 'INITIAL-STOCK', notes: 'Initial box stock' },
      { product_id: productIds[6], type: 'IN', qty: 15, ref: 'INITIAL-STOCK', notes: 'Initial tape stock' }, // Low stock check (Reorder: 40)
      
      // Stock deductions
      { product_id: productIds[0], type: 'OUT', qty: 3, ref: 'SALE-1001', notes: 'Fulfillment for order #1001' },
      { product_id: productIds[1], type: 'OUT', qty: 10, ref: 'SALE-1002', notes: 'Customer shipment #1002' },
      { product_id: productIds[3], type: 'OUT', qty: 40, ref: 'OFFICE-ADJUST', notes: 'Consumed internal use' }
    ];

    for (const t of transactions) {
      await dbRun(
        'INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES (?, ?, ?, ?, ?)',
        [t.product_id, t.type, t.qty, t.ref, t.notes]
      );
    }

    // 4. Seed Purchase Orders & Purchase Order Items (ACID Transaction simulation)
    // Order 1: Delivered Purchase Order
    const po1 = await dbRun(
      'INSERT INTO purchase_orders (supplier_id, order_date, expected_date, delivery_date, total_amount, status) VALUES (?, datetime("now", "-10 day"), datetime("now", "-6 day"), datetime("now", "-5 day"), ?, "PENDING")',
      [supplierIds[0], 2400.0]
    );
    await dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 2, 1200.0, 2)',
      [po1.lastID, productIds[0]]
    );
    // Update status to DELIVERED now that items are attached
    await dbRun('UPDATE purchase_orders SET status = "DELIVERED" WHERE id = ?', [po1.lastID]);
    // Add transaction IN for this completed order
    await dbRun(
      'INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes, transaction_date) VALUES (?, "IN", 2, ?, "Fulfillment from PO", datetime("now", "-5 day"))',
      [productIds[0], `PO-${po1.lastID}`]
    );

    // Order 2: Pending Purchase Order
    const po2 = await dbRun(
      'INSERT INTO purchase_orders (supplier_id, order_date, expected_date, total_amount, status) VALUES (?, datetime("now", "-2 day"), datetime("now", "+5 day"), ?, "PENDING")',
      [supplierIds[1], 195.0]
    );
    await dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 10, 6.5, 0)',
      [po2.lastID, productIds[3]]
    );
    await dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 10, 12.0, 0)',
      [po2.lastID, productIds[4]]
    );

    // Order 3: Shipped Purchase Order
    const po3 = await dbRun(
      'INSERT INTO purchase_orders (supplier_id, order_date, expected_date, total_amount, status) VALUES (?, datetime("now", "-3 day"), datetime("now", "+1 day"), ?, "PENDING")',
      [supplierIds[2], 1280.0]
    );
    await dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 400, 3.2, 0)',
      [po3.lastID, productIds[6]]
    );
    // Update status to SHIPPED now that items are attached
    await dbRun('UPDATE purchase_orders SET status = "SHIPPED" WHERE id = ?', [po3.lastID]);

    await dbRun('COMMIT');
    console.log('Database seeding completed successfully.');
  } catch (error) {
    await dbRun('ROLLBACK');
    console.error('Database seeding failed. Rollback executed.', error);
    throw error;
  }
}

// Cursor-based reconciliation
export async function reconcileInventoryWithCursor(applyFix = false) {
  const products = await dbAll('SELECT id, sku, name, quantity_in_stock FROM products');
  const results = [];
  
  for (const product of products) {
    let computedQuantity = 0;
    
    // Simulating database cursor - fetching row-by-row and updating running total
    await new Promise((resolve, reject) => {
      db.each(
        'SELECT transaction_type, quantity FROM stock_transactions WHERE product_id = ?',
        [product.id],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            // Process row immediately (cursor row traversal action)
            if (row.transaction_type === 'IN') {
              computedQuantity += row.quantity;
            } else if (row.transaction_type === 'OUT') {
              computedQuantity -= row.quantity;
            } else if (row.transaction_type === 'ADJUSTMENT') {
              computedQuantity += row.quantity; // adjust can be positive or negative
            }
          }
        },
        (err, count) => {
          if (err) reject(err);
          else resolve(count);
        }
      );
    });
    
    const discrepancy = computedQuantity - product.quantity_in_stock;
    const needsFix = discrepancy !== 0;
    
    if (needsFix && applyFix) {
      // Reconcile by updating the product row to match transaction ledger total
      await dbRun('UPDATE products SET quantity_in_stock = ? WHERE id = ?', [computedQuantity, product.id]);
      product.quantity_in_stock = computedQuantity; // update local representation
    }
    
    results.push({
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      actual_stock: product.quantity_in_stock,
      computed_stock: computedQuantity,
      discrepancy,
      reconciled: applyFix && needsFix
    });
  }
  
  return results;
}

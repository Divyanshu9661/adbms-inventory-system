import pg from 'pg';

const { Pool } = pg;

// Read connection string from environment variable (Supabase/Postgres)
// Default to standard local postgres configuration for testing
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper to convert SQLite's '?' placeholders to PostgreSQL's '$1', '$2', ...
export function convertToPgSql(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

// Wrapper for querying multiple rows
export const dbAll = async (sql, params = []) => {
  const pgSql = convertToPgSql(sql);
  const res = await pool.query(pgSql, params);
  return res.rows;
};

// Wrapper for querying a single row
export const dbGet = async (sql, params = []) => {
  const pgSql = convertToPgSql(sql);
  const res = await pool.query(pgSql, params);
  return res.rows[0];
};

// Wrapper for executing insert/update/delete commands
export const dbRun = async (sql, params = []) => {
  let pgSql = convertToPgSql(sql);
  
  // To mimic SQLite's lastID, append RETURNING id to INSERT queries
  const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
  if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
    pgSql += ' RETURNING id';
  }
  
  const res = await pool.query(pgSql, params);
  
  return {
    lastID: isInsert && res.rows[0] ? res.rows[0].id : null,
    changes: res.rowCount
  };
};

// Transaction Execution Helper (Ensures commands execute sequentially on the same pool client)
export async function runTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create transaction-bound wrappers
    const dbAllTx = async (sql, params = []) => {
      const pgSql = convertToPgSql(sql);
      const res = await client.query(pgSql, params);
      return res.rows;
    };
    
    const dbGetTx = async (sql, params = []) => {
      const pgSql = convertToPgSql(sql);
      const res = await client.query(pgSql, params);
      return res.rows[0];
    };
    
    const dbRunTx = async (sql, params = []) => {
      let pgSql = convertToPgSql(sql);
      const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
      if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
        pgSql += ' RETURNING id';
      }
      const res = await client.query(pgSql, params);
      return {
        lastID: isInsert && res.rows[0] ? res.rows[0].id : null,
        changes: res.rowCount
      };
    };

    const result = await callback({ dbAll: dbAllTx, dbGet: dbGetTx, dbRun: dbRunTx });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Initialize database schema, triggers, views, and indexes
export async function initializeDatabase(forceReset = false) {
  if (forceReset) {
    console.log('Force resetting database... dropping tables, views, and triggers.');
    const dropQueries = [
      'DROP VIEW IF EXISTS v_low_stock_alerts CASCADE',
      'DROP VIEW IF EXISTS v_supplier_performance CASCADE',
      'DROP VIEW IF EXISTS v_stock_valuation CASCADE',
      'DROP TABLE IF EXISTS inventory_audit_log CASCADE',
      'DROP TABLE IF EXISTS stock_transactions CASCADE',
      'DROP TABLE IF EXISTS purchase_order_items CASCADE',
      'DROP TABLE IF EXISTS purchase_orders CASCADE',
      'DROP TABLE IF EXISTS products CASCADE',
      'DROP TABLE IF EXISTS suppliers CASCADE'
    ];
    for (const query of dropQueries) {
      try {
        await pool.query(query);
      } catch (err) {
        console.warn(`Warning during reset query "${query}":`, err.message);
      }
    }
  }

  // Create tables in PostgreSQL (Adapted from supabase_setup.sql)
  const ddlSchema = `
    -- Table A: Suppliers Directory (3NF)
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(50) NOT NULL,
      address TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Table B: Product Catalog (3NF)
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100) NOT NULL,
      price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
      quantity_in_stock INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Table C: Purchase Orders Header (3NF)
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expected_date TIMESTAMP,
      delivery_date TIMESTAMP,
      total_amount NUMERIC(12, 2) DEFAULT 0.0 CHECK (total_amount >= 0),
      status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Table D: Purchase Order Line Items (3NF)
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
      received_quantity INTEGER DEFAULT 0 CHECK (received_quantity >= 0)
    );

    -- Table E: Inventory Ledger Transactions (3NF)
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('IN', 'OUT', 'ADJUSTMENT')),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      reference_id VARCHAR(100),
      notes TEXT,
      transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Table F: Automated Audit Trails (3NF)
    CREATE TABLE IF NOT EXISTS inventory_audit_log (
      id SERIAL PRIMARY KEY,
      table_name VARCHAR(100) NOT NULL,
      action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('INSERT', 'UPDATE', 'DELETE')),
      record_id INTEGER NOT NULL,
      old_values TEXT, -- JSON string representation
      new_values TEXT, -- JSON string representation
      changed_by VARCHAR(100) DEFAULT 'SYSTEM',
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(ddlSchema);

  // Create Indexes
  const indexSchema = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_stock_transactions_prod_date ON stock_transactions(product_id, transaction_date);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);
  `;
  await pool.query(indexSchema);

  // Create Views
  const viewsSchema = `
    CREATE OR REPLACE VIEW v_low_stock_alerts AS
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

    CREATE OR REPLACE VIEW v_supplier_performance AS
    SELECT 
        s.id AS supplier_id,
        s.name AS supplier_name,
        s.contact_name,
        s.email,
        COUNT(po.id) AS total_orders,
        COALESCE(SUM(po.total_amount), 0) AS total_spend,
        AVG(CASE WHEN po.status = 'DELIVERED' AND po.delivery_date IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (po.delivery_date - po.order_date)) / 86400.0 
        END) AS avg_lead_time_days,
        (CAST(SUM(CASE WHEN po.status = 'DELIVERED' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(po.id), 0)) * 100 AS fulfillment_rate
    FROM suppliers s
    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
    GROUP BY s.id, s.name, s.contact_name, s.email;

    CREATE OR REPLACE VIEW v_stock_valuation AS
    SELECT 
        category,
        COUNT(id) AS product_count,
        SUM(quantity_in_stock) AS total_items,
        SUM(quantity_in_stock * price) AS total_valuation
    FROM products
    WHERE status = 'Active'
    GROUP BY category;
  `;
  await pool.query(viewsSchema);

  // Create triggers and their functions (PL/pgSQL)
  const triggersAndFunctions = `
    -- Function & Trigger 1: Auto-adjust stock
    CREATE OR REPLACE FUNCTION update_stock_on_transaction_fn()
    RETURNS TRIGGER AS $$
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
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_update_stock_on_transaction ON stock_transactions;
    CREATE TRIGGER trg_update_stock_on_transaction
    AFTER INSERT ON stock_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_on_transaction_fn();

    -- Function & Trigger 2: Prevent negative stock
    CREATE OR REPLACE FUNCTION prevent_negative_stock_fn()
    RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.quantity_in_stock < 0 THEN
            RAISE EXCEPTION 'DBMS Constraint Error: Quantity in stock cannot fall below 0.';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_prevent_negative_stock ON products;
    CREATE TRIGGER trg_prevent_negative_stock
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION prevent_negative_stock_fn();

    -- Function & Trigger 3: Audit products updates
    CREATE OR REPLACE FUNCTION audit_products_update_fn()
    RETURNS TRIGGER AS $$
    BEGIN
        IF OLD.quantity_in_stock <> NEW.quantity_in_stock OR OLD.price <> NEW.price THEN
            INSERT INTO inventory_audit_log (table_name, action_type, record_id, old_values, new_values, changed_by)
            VALUES (
                'products',
                'UPDATE',
                NEW.id,
                json_build_object('quantity_in_stock', OLD.quantity_in_stock, 'price', OLD.price)::text,
                json_build_object('quantity_in_stock', NEW.quantity_in_stock, 'price', NEW.price)::text,
                'DB_TRIGGER_PRODUCTS'
            );
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_audit_products_update ON products;
    CREATE TRIGGER trg_audit_products_update
    AFTER UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION audit_products_update_fn();

    -- Function & Trigger 4: Audit PO status updates
    CREATE OR REPLACE FUNCTION audit_purchase_orders_update_fn()
    RETURNS TRIGGER AS $$
    BEGIN
        IF OLD.status <> NEW.status THEN
            INSERT INTO inventory_audit_log (table_name, action_type, record_id, old_values, new_values, changed_by)
            VALUES (
                'purchase_orders',
                'UPDATE',
                NEW.id,
                json_build_object('status', OLD.status)::text,
                json_build_object('status', NEW.status)::text,
                'DB_TRIGGER_ORDERS'
            );
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_audit_purchase_orders_update ON purchase_orders;
    CREATE TRIGGER trg_audit_purchase_orders_update
    AFTER UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION audit_purchase_orders_update_fn();

    -- Function & Trigger 5: Prevent line item inserts on finalized POs
    CREATE OR REPLACE FUNCTION prevent_po_item_insert_on_processed_po_fn()
    RETURNS TRIGGER AS $$
    DECLARE
        po_status VARCHAR(20);
    BEGIN
        SELECT status INTO po_status FROM purchase_orders WHERE id = NEW.order_id;
        IF po_status <> 'PENDING' THEN
            RAISE EXCEPTION 'DBMS Constraint Error: Cannot add items to a purchase order that is not PENDING.';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_prevent_po_item_insert_on_processed_po ON purchase_order_items;
    CREATE TRIGGER trg_prevent_po_item_insert_on_processed_po
    BEFORE INSERT ON purchase_order_items
    FOR EACH ROW
    EXECUTE FUNCTION prevent_po_item_insert_on_processed_po_fn();
  `;
  await pool.query(triggersAndFunctions);

  // Seed database if empty
  const supplierCount = await dbGet('SELECT COUNT(*) AS count FROM suppliers');
  if (parseInt(supplierCount.count) === 0) {
    console.log('No existing data in PostgreSQL. Seeding mock dataset...');
    await seedDatabase();
  } else {
    console.log('Database already has data. Skipping seed.');
  }
}

// Transaction-safe Seeding Script
async function seedDatabase() {
  await runTransaction(async (tx) => {
    // 1. Seed Suppliers
    const suppliers = [
      { name: 'Quantum Electronics', contact: 'Alice Chen', email: 'sales@quantum.com', phone: '+1-555-0199', address: 'Silicon Valley, CA' },
      { name: 'Office Depot Logistics', contact: 'Robert Jenkins', email: 'orders@officedepot.com', phone: '+1-800-555-0122', address: 'Chicago, IL' },
      { name: 'Apex Packaging Corp', contact: 'Sarah Smith', email: 'sarah@apexpack.com', phone: '+1-312-555-0144', address: 'Detroit, MI' }
    ];

    const supplierIds = [];
    for (const s of suppliers) {
      const result = await tx.dbRun(
        'INSERT INTO suppliers (name, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?)',
        [s.name, s.contact, s.email, s.phone, s.address]
      );
      supplierIds.push(result.lastID);
    }

    // 2. Seed Products (Starts with 0 stock)
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
      const result = await tx.dbRun(
        'INSERT INTO products (sku, name, description, category, price, reorder_level, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.sku, p.name, p.desc, p.cat, p.price, p.reorder, p.supplier_id]
      );
      productIds.push(result.lastID);
    }

    // Adjust sequence counter for serial columns after seeding explicit IDs if needed
    // In our case we are letting serial auto-generate IDs, so we push them directly and save lastID.

    // 3. Seed Stock Transactions (This will fire triggers to update products' QuantityInStock!)
    const transactions = [
      { product_id: productIds[0], type: 'IN', qty: 20, ref: 'INITIAL-STOCK', notes: 'Warehouse opening stock' },
      { product_id: productIds[1], type: 'IN', qty: 50, ref: 'INITIAL-STOCK', notes: 'Warehouse opening stock' },
      { product_id: productIds[2], type: 'IN', qty: 30, ref: 'INITIAL-STOCK', notes: 'Warehouse opening stock' },
      { product_id: productIds[3], type: 'IN', qty: 200, ref: 'INITIAL-STOCK', notes: 'Initial logistics purchase' },
      { product_id: productIds[4], type: 'IN', qty: 10, ref: 'INITIAL-STOCK', notes: 'Initial low quantity pen seed' },
      { product_id: productIds[5], type: 'IN', qty: 500, ref: 'INITIAL-STOCK', notes: 'Initial box stock' },
      { product_id: productIds[6], type: 'IN', qty: 15, ref: 'INITIAL-STOCK', notes: 'Initial tape stock' },
      
      // Stock deductions
      { product_id: productIds[0], type: 'OUT', qty: 3, ref: 'SALE-1001', notes: 'Fulfillment for order #1001' },
      { product_id: productIds[1], type: 'OUT', qty: 10, ref: 'SALE-1002', notes: 'Customer shipment #1002' },
      { product_id: productIds[3], type: 'OUT', qty: 40, ref: 'OFFICE-ADJUST', notes: 'Consumed internal use' }
    ];

    for (const t of transactions) {
      await tx.dbRun(
        'INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES (?, ?, ?, ?, ?)',
        [t.product_id, t.type, t.qty, t.ref, t.notes]
      );
    }

    // 4. Seed Purchase Orders & Items
    // Order 1: Delivered
    const po1 = await tx.dbRun(
      "INSERT INTO purchase_orders (supplier_id, order_date, expected_date, total_amount, status) VALUES (?, NOW() - INTERVAL '10 days', NOW() - INTERVAL '6 days', ?, 'PENDING')",
      [supplierIds[0], 2400.0]
    );
    await tx.dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 2, 1200.0, 2)',
      [po1.lastID, productIds[0]]
    );
    await tx.dbRun("UPDATE purchase_orders SET status = 'DELIVERED', delivery_date = NOW() - INTERVAL '5 days' WHERE id = ?", [po1.lastID]);
    await tx.dbRun(
      "INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes, transaction_date) VALUES (?, 'IN', 2, ?, 'Fulfillment from PO', NOW() - INTERVAL '5 days')",
      [productIds[0], `PO-${po1.lastID}`]
    );

    // Order 2: Pending
    const po2 = await tx.dbRun(
      "INSERT INTO purchase_orders (supplier_id, order_date, expected_date, total_amount, status) VALUES (?, NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', ?, 'PENDING')",
      [supplierIds[1], 195.0]
    );
    await tx.dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 10, 6.5, 0)',
      [po2.lastID, productIds[3]]
    );
    await tx.dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 10, 12.0, 0)',
      [po2.lastID, productIds[4]]
    );

    // Order 3: Shipped
    const po3 = await tx.dbRun(
      "INSERT INTO purchase_orders (supplier_id, order_date, expected_date, total_amount, status) VALUES (?, NOW() - INTERVAL '3 days', NOW() + INTERVAL '1 day', ?, 'PENDING')",
      [supplierIds[2], 1280.0]
    );
    await tx.dbRun(
      'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, 400, 3.2, 0)',
      [po3.lastID, productIds[6]]
    );
    await tx.dbRun("UPDATE purchase_orders SET status = 'SHIPPED' WHERE id = ?", [po3.lastID]);
  });
  console.log('PostgreSQL database seeding completed successfully.');
}

// Cursor-based reconciliation
export async function reconcileInventoryWithCursor(applyFix = false) {
  const products = await dbAll('SELECT id, sku, name, quantity_in_stock FROM products');
  const results = [];
  
  for (const product of products) {
    let computedQuantity = 0;
    
    // Simulate cursor row-by-row processing in JS
    const transactions = await dbAll(
      'SELECT transaction_type, quantity FROM stock_transactions WHERE product_id = ?',
      [product.id]
    );
    
    for (const row of transactions) {
      if (row.transaction_type === 'IN') {
        computedQuantity += row.quantity;
      } else if (row.transaction_type === 'OUT') {
        computedQuantity -= row.quantity;
      } else if (row.transaction_type === 'ADJUSTMENT') {
        computedQuantity += row.quantity;
      }
    }
    
    const discrepancy = computedQuantity - parseInt(product.quantity_in_stock);
    const needsFix = discrepancy !== 0;
    
    if (needsFix && applyFix) {
      await dbRun('UPDATE products SET quantity_in_stock = ? WHERE id = ?', [computedQuantity, product.id]);
      product.quantity_in_stock = computedQuantity;
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

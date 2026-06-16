import express from 'express';
import cors from 'cors';
import { 
  dbAll, 
  dbGet, 
  dbRun, 
  initializeDatabase,
  reconcileInventoryWithCursor,
  runTransaction
} from './database.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize the database on server startup
initializeDatabase()
  .then(() => {
    console.log('Database initialized successfully.');
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
  });

// --- DASHBOARD ENDPOINTS ---

// Fetch high-level KPIs and chart data
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const valuation = await dbAll('SELECT * FROM v_stock_valuation');
    const lowStockAlerts = await dbGet('SELECT COUNT(*) AS count FROM v_low_stock_alerts');
    const activePOs = await dbGet('SELECT COUNT(*) AS count FROM purchase_orders WHERE status IN ("PENDING", "SHIPPED")');
    const supplierCount = await dbGet('SELECT COUNT(*) AS count FROM suppliers WHERE status = "Active"');
    const totalValuation = valuation.reduce((acc, row) => acc + (row.total_valuation || 0), 0);
    const totalItems = valuation.reduce((acc, row) => acc + (row.total_items || 0), 0);
    const totalProducts = valuation.reduce((acc, row) => acc + (row.product_count || 0), 0);

    res.json({
      totalValuation,
      totalItems,
      totalProducts,
      lowStockAlertCount: lowStockAlerts.count,
      activePOCount: activePOs.count,
      supplierCount: supplierCount.count,
      categoryValuation: valuation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PRODUCTS ENDPOINTS ---

// List all products
app.get('/api/products', async (req, res) => {
  try {
    const query = `
      SELECT p.*, s.name AS supplier_name 
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.id DESC
    `;
    const products = await dbAll(query);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get low stock alerts view
app.get('/api/products/low-stock', async (req, res) => {
  try {
    const alerts = await dbAll('SELECT * FROM v_low_stock_alerts');
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new product
app.post('/api/products', async (req, res) => {
  const { sku, name, description, category, price, reorder_level, supplier_id } = req.body;
  if (!sku || !name || !category || price === undefined) {
    return res.status(400).json({ error: 'SKU, name, category, and price are required.' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO products (sku, name, description, category, price, reorder_level, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sku.trim().toUpperCase(), name, description, category, parseFloat(price), reorder_level || 0, supplier_id || null]
    );
    const newProduct = await dbGet('SELECT * FROM products WHERE id = ?', [result.lastID]);
    res.status(201).json(newProduct);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: products.sku')) {
      return res.status(400).json({ error: `SKU '${sku}' already exists.` });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update a product (Updates will fire audit triggers if quantity or price changes)
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, category, price, reorder_level, supplier_id, status } = req.body;

  try {
    await dbRun(
      `UPDATE products 
       SET name = COALESCE(?, name), 
           description = COALESCE(?, description), 
           category = COALESCE(?, category), 
           price = COALESCE(?, price), 
           reorder_level = COALESCE(?, reorder_level), 
           supplier_id = COALESCE(?, supplier_id), 
           status = COALESCE(?, status)
       WHERE id = ?`,
      [name, description, category, price, reorder_level, supplier_id, status, id]
    );
    const updated = await dbGet('SELECT * FROM products WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SUPPLIERS ENDPOINTS ---

// List all suppliers
app.get('/api/suppliers', async (req, res) => {
  try {
    const suppliers = await dbAll('SELECT * FROM suppliers ORDER BY name ASC');
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get supplier performance view
app.get('/api/suppliers/performance', async (req, res) => {
  try {
    const performance = await dbAll('SELECT * FROM v_supplier_performance');
    res.json(performance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new supplier
app.post('/api/suppliers', async (req, res) => {
  const { name, contact_name, email, phone, address } = req.body;
  if (!name || !contact_name || !email || !phone || !address) {
    return res.status(400).json({ error: 'All supplier fields are required.' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO suppliers (name, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?)',
      [name, contact_name, email, phone, address]
    );
    const newSupplier = await dbGet('SELECT * FROM suppliers WHERE id = ?', [result.lastID]);
    res.status(201).json(newSupplier);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: suppliers.email')) {
      return res.status(400).json({ error: `Supplier email '${email}' already registered.` });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- PURCHASE ORDERS ENDPOINTS ---

// List all purchase orders with supplier names
app.get('/api/purchase-orders', async (req, res) => {
  try {
    const query = `
      SELECT po.*, s.name AS supplier_name 
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      ORDER BY po.id DESC
    `;
    const pos = await dbAll(query);
    
    // Fetch items for each PO
    for (const po of pos) {
      po.items = await dbAll(
        `SELECT poi.*, p.name AS product_name, p.sku AS product_sku 
         FROM purchase_order_items poi
         JOIN products p ON poi.product_id = p.id
         WHERE poi.order_id = ?`,
        [po.id]
      );
    }
    res.json(pos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a Purchase Order (ACID Transaction)
app.post('/api/purchase-orders', async (req, res) => {
  const { supplier_id, expected_date, items } = req.body;
  if (!supplier_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Supplier ID and list of items are required.' });
  }

  // Begin Explicit Transaction
  try {
    const createdPO = await runTransaction(async (tx) => {
      // Calculate total amount
      let totalAmount = 0;
      for (const item of items) {
        if (!item.product_id || !item.quantity || !item.unit_price) {
          throw new Error('All order items must have product_id, quantity, and unit_price.');
        }
        totalAmount += parseInt(item.quantity) * parseFloat(item.unit_price);
      }

      // Create Purchase Order record
      const poResult = await tx.dbRun(
        'INSERT INTO purchase_orders (supplier_id, expected_date, total_amount, status) VALUES (?, ?, ?, "PENDING")',
        [supplier_id, expected_date || null, totalAmount]
      );
      const poId = poResult.lastID;

      // Insert Purchase Order items
      for (const item of items) {
        await tx.dbRun(
          'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, received_quantity) VALUES (?, ?, ?, ?, 0)',
          [poId, item.product_id, item.quantity, item.unit_price]
        );
      }

      // Fetch full created order to return
      const po = await tx.dbGet('SELECT * FROM purchase_orders WHERE id = ?', [poId]);
      po.items = await tx.dbAll(
        'SELECT poi.*, p.name AS product_name FROM purchase_order_items poi JOIN products p ON poi.product_id = p.id WHERE poi.order_id = ?',
        [poId]
      );
      return po;
    });
    res.status(201).json(createdPO);
  } catch (err) {
    console.error('Purchase Order Transaction Rolled Back:', err.message);
    res.status(400).json({ error: `Transaction aborted: ${err.message}` });
  }
});

// Update Purchase Order Status (Transaction-safe state changes)
app.put('/api/purchase-orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // PENDING, SHIPPED, DELIVERED, CANCELLED

  if (!['PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid purchase order status.' });
  }

  // Fetch the current PO details
  const po = await dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (!po) {
    return res.status(404).json({ error: 'Purchase Order not found.' });
  }

  if (po.status === 'DELIVERED' || po.status === 'CANCELLED') {
    return res.status(400).json({ error: `Cannot change status of an already ${po.status.toLowerCase()} order.` });
  }

  try {
    const updatedPO = await runTransaction(async (tx) => {
      let deliveryDate = null;
      if (status === 'DELIVERED') {
        deliveryDate = new Date().toISOString();
        
        // 1. Retrieve all items for this PO
        const items = await tx.dbAll('SELECT * FROM purchase_order_items WHERE order_id = ?', [id]);
        
        for (const item of items) {
          // Update item's received quantity to match ordered quantity
          await tx.dbRun(
            'UPDATE purchase_order_items SET received_quantity = quantity WHERE id = ?',
            [item.id]
          );

          // 2. Insert Stock Transaction (This triggers trg_update_stock_on_transaction automatically!)
          await tx.dbRun(
            `INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes)
             VALUES (?, 'IN', ?, ?, 'Received stock from Purchase Order')`,
            [item.product_id, item.quantity, `PO-${id}`]
          );
        }
      }

      // Update PO status, delivery date, and updated_at
      await tx.dbRun(
        `UPDATE purchase_orders 
         SET status = ?, delivery_date = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [status, deliveryDate, id]
      );

      return await tx.dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    });
    res.json(updatedPO);
  } catch (err) {
    console.error('Update PO Status Transaction Rolled Back:', err.message);
    res.status(500).json({ error: `Transaction aborted: ${err.message}` });
  }
});

// --- STOCK TRANSACTIONS ENDPOINTS ---

// Get all stock transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await dbAll(`
      SELECT t.*, p.name AS product_name, p.sku AS product_sku
      FROM stock_transactions t
      JOIN products p ON t.product_id = p.id
      ORDER BY t.id DESC
    `);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Insert custom adjustment/manual stock transaction (will trigger quantity changes & negative stock constraints)
app.post('/api/transactions', async (req, res) => {
  const { product_id, transaction_type, quantity, notes } = req.body;
  if (!product_id || !transaction_type || !quantity) {
    return res.status(400).json({ error: 'Product ID, Transaction Type, and Quantity are required.' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES (?, ?, ?, "MANUAL", ?)',
      [product_id, transaction_type, parseInt(quantity), notes || 'Manual stock adjustment']
    );
    const newTx = await dbGet('SELECT * FROM stock_transactions WHERE id = ?', [result.lastID]);
    res.status(201).json(newTx);
  } catch (err) {
    // If the negative stock trigger aborts the query, we capture it and return a neat message.
    if (err.message.includes('DBMS Constraint Error')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- ADBMS DIAGNOSTICS & AUDIT LOGS ENDPOINTS ---

// Fetch audit logs
app.get('/api/audit-logs', async (req, res) => {
  try {
    const logs = await dbAll('SELECT * FROM inventory_audit_log ORDER BY id DESC');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Database Schema Visualizer (Querying Master Tables)
app.get('/api/db/schema', async (req, res) => {
  try {
    // Fetch tables, indexes, triggers, and views from PostgreSQL catalog
    const tables = await dbAll(`
      SELECT table_name AS name, '' AS sql 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const indexes = await dbAll(`
      SELECT indexname AS name, tablename AS tbl_name, indexdef AS sql 
      FROM pg_indexes 
      WHERE schemaname = 'public'
    `);
    const triggers = await dbAll(`
      SELECT trigger_name AS name, event_object_table AS tbl_name, '' AS sql 
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
    `);
    const views = await dbAll(`
      SELECT table_name AS name, view_definition AS sql 
      FROM information_schema.views 
      WHERE table_schema = 'public'
    `);

    res.json({ tables, indexes, triggers, views });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DB Query Console + Execution Analyzer
app.post('/api/db/query', async (req, res) => {
  const { query } = req.body;
  if (!query || query.trim() === '') {
    return res.status(400).json({ error: 'Query string is required.' });
  }

  // Security warning: Allow reads and writes to demonstrate features, but prevent drop-database type disasters
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery.startsWith('drop table') || lowerQuery.includes('drop database')) {
    return res.status(403).json({ error: 'Action denied: Drop commands are disabled to preserve database structure.' });
  }

  try {
    let result = null;
    let explainPlan = null;

    if (lowerQuery.startsWith('select')) {
      // 1. Run actual query
      result = await dbAll(query);
      
      // 2. Fetch Query Plan automatically (ADBMS optimization concept)
      explainPlan = await dbAll(`EXPLAIN ${query}`);
    } else {
      // For updates, inserts, deletes
      const resRun = await dbRun(query);
      result = {
        message: 'Query executed successfully.',
        rowsAffected: resRun.changes,
        lastInsertRowId: resRun.lastID
      };
    }

    res.json({
      success: true,
      data: result,
      explain: explainPlan
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Cursor Reconciliation endpoints (ADBMS concept)
app.get('/api/db/reconcile-cursor', async (req, res) => {
  try {
    const report = await reconcileInventoryWithCursor(false);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/db/reconcile-cursor', async (req, res) => {
  try {
    const report = await reconcileInventoryWithCursor(true);
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start express server
app.listen(PORT, () => {
  console.log(`ADBMS backend server running on http://localhost:${PORT}`);
});

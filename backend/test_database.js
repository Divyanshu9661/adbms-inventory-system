import { initializeDatabase, dbAll, dbGet, dbRun, pool, reconcileInventoryWithCursor, runTransaction } from './database.js';

async function runTests() {
  console.log('--- STARTING ADBMS DATABASE UNIT TESTS ---');

  try {
    // 1. Reset database and run schema/seed
    console.log('\n[TEST 1] Initializing and Seeding Database...');
    await initializeDatabase(true); // force reset
    
    const suppliers = await dbAll('SELECT * FROM suppliers');
    console.log(`Success: Seeded ${suppliers.length} suppliers.`);
    
    const products = await dbAll('SELECT * FROM products');
    console.log(`Success: Seeded ${products.length} products.`);

    // 2. Test trg_update_stock_on_transaction (IN trigger)
    console.log('\n[TEST 2] Testing Stock Transaction Triggers (IN)...');
    const prodBefore = await dbGet("SELECT quantity_in_stock FROM products WHERE sku = 'ELEC-LAP-001'");
    console.log(`Stock before transaction: ${prodBefore.quantity_in_stock}`);
    
    await dbRun(
      "INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES (1, 'IN', 10, 'TEST-IN', 'Adding 10 laptops')"
    );
    
    const prodAfterIN = await dbGet("SELECT quantity_in_stock FROM products WHERE sku = 'ELEC-LAP-001'");
    console.log(`Stock after IN (+10): ${prodAfterIN.quantity_in_stock}`);
    if (prodAfterIN.quantity_in_stock !== prodBefore.quantity_in_stock + 10) {
      throw new Error('Stock did not increase properly after IN transaction!');
    }
    console.log('Success: trg_update_stock_on_transaction (IN) passed.');

    // 3. Test trg_update_stock_on_transaction (OUT trigger)
    console.log('\n[TEST 3] Testing Stock Transaction Triggers (OUT)...');
    await dbRun(
      "INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES (1, 'OUT', 5, 'TEST-OUT', 'Deducting 5 laptops')"
    );
    
    const prodAfterOUT = await dbGet("SELECT quantity_in_stock FROM products WHERE sku = 'ELEC-LAP-001'");
    console.log(`Stock after OUT (-5): ${prodAfterOUT.quantity_in_stock}`);
    if (prodAfterOUT.quantity_in_stock !== prodAfterIN.quantity_in_stock - 5) {
      throw new Error('Stock did not decrease properly after OUT transaction!');
    }
    console.log('Success: trg_update_stock_on_transaction (OUT) passed.');

    // 4. Test trg_prevent_negative_stock (Negative Stock Constraint)
    console.log('\n[TEST 4] Testing Prevent Negative Stock Trigger...');
    const currentStock = prodAfterOUT.quantity_in_stock;
    console.log(`Current stock of Product #1: ${currentStock}`);
    
    try {
      console.log(`Attempting to deduct ${currentStock + 10} units (should fail)...`);
      await dbRun(
        "INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes) VALUES (1, 'OUT', ?, 'TEST-NEG', 'Attempting negative stock')",
        [currentStock + 10]
      );
      throw new Error('FAIL: Database allowed negative stock level!');
    } catch (err) {
      if (err.message.includes('DBMS Constraint Error')) {
        console.log(`Success: Stock reduction blocked with error: "${err.message}"`);
      } else {
        console.error('An unexpected error occurred:', err);
        throw err;
      }
    }

    // 5. Test trg_audit_products_update (Audit logs for updates)
    console.log('\n[TEST 5] Testing Product Audit Log Triggers...');
    console.log('Updating product price from $1200.00 to $1250.00...');
    await dbRun('UPDATE products SET price = 1250.0 WHERE id = 1');
    
    const auditLogs = await dbAll("SELECT * FROM inventory_audit_log WHERE table_name = 'products'");
    console.log(`Audit log records found: ${auditLogs.length}`);
    if (auditLogs.length === 0) {
      throw new Error('Audit log record was not created on price update!');
    }
    console.log('Audit log entry details:');
    console.log(JSON.stringify(auditLogs[auditLogs.length - 1], null, 2));
    console.log('Success: Audit trigger passed.');

    // 6. Test ACID Transactions & Rollback
    console.log('\n[TEST 6] Testing Transaction Atomicity & Rollback...');
    // A: Successful Transaction
    console.log('Creating a valid Purchase Order (PO) with multiple items in a transaction...');
    try {
      const lastID = await runTransaction(async (tx) => {
        const po = await tx.dbRun(
          "INSERT INTO purchase_orders (supplier_id, total_amount, status) VALUES (2, 24.0, 'PENDING')"
        );
        await tx.dbRun(
          'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price) VALUES (?, 4, 2, 12.0)',
          [po.lastID]
        );
        return po.lastID;
      });
      console.log(`Transaction Committed: Created PO ID ${lastID}`);
    } catch (txErr) {
      console.error('Valid transaction failed and rolled back:', txErr);
      throw txErr;
    }

    // B: Failed Transaction (Ensuring Rollback occurs)
    console.log('Creating an invalid transaction (first item valid, second item invalid)...');
    const poCountBefore = await dbGet('SELECT COUNT(*) AS count FROM purchase_orders');
    try {
      await runTransaction(async (tx) => {
        const po = await tx.dbRun(
          "INSERT INTO purchase_orders (supplier_id, total_amount, status) VALUES (2, 12.0, 'PENDING')"
        );
        // Valid item
        await tx.dbRun(
          'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price) VALUES (?, 4, 1, 12.0)',
          [po.lastID]
        );
        // Invalid item (breaks quantity > 0 check constraint)
        await tx.dbRun(
          'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price) VALUES (?, 4, -5, 12.0)',
          [po.lastID]
        );
      });
      throw new Error('FAIL: PostgreSQL allowed invalid purchase order item quantity (<= 0)');
    } catch (txErr) {
      console.log(`Rollback Executed successfully. Caught expected error: "${txErr.message}"`);
      const poCountAfter = await dbGet('SELECT COUNT(*) AS count FROM purchase_orders');
      if (parseInt(poCountBefore.count) !== parseInt(poCountAfter.count)) {
        throw new Error('FAIL: Atomicity broken! PO record was committed despite items failing.');
      }
      console.log('Success: Transaction rolled back completely, database state preserved.');
    }

    // 7. Test validation trigger on non-pending POs
    console.log('\n[TEST 7] Testing PO Item Validation Trigger...');
    try {
      console.log('Attempting to add item to DELIVERED Purchase Order #1 (should fail)...');
      await dbRun(
        'INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price) VALUES (1, 1, 5, 1200.0)'
      );
      throw new Error('FAIL: Trigger allowed adding item to DELIVERED Purchase Order!');
    } catch (err) {
      if (err.message.includes('Cannot add items to a purchase order that is not PENDING')) {
        console.log(`Success: Blocked insertion with trigger error: "${err.message}"`);
      } else {
        throw err;
      }
    }

    // 8. Test Cursor-based Inventory Reconciliation
    console.log('\n[TEST 8] Testing Cursor Stock Reconciliation...');
    // A: Intentionally introduce a stock discrepancy by bypassing triggers (direct update)
    console.log('Artificially introducing discrepancy on product #2 (changing stock from 50 to 999)...');
    await dbRun('UPDATE products SET quantity_in_stock = 999 WHERE id = 2');
    
    // B: Run cursor reconciliation check
    console.log('Running cursor-based check...');
    let reconciliationReport = await reconcileInventoryWithCursor(false);
    let item2 = reconciliationReport.find(r => r.product_id === 2);
    console.log(`Discrepancy detected for Product #2: ${item2.discrepancy} units (Actual: ${item2.actual_stock}, Computed: ${item2.computed_stock})`);
    if (item2.discrepancy !== -959) { // 40 computed - 999 actual = -959
      throw new Error(`Expected discrepancy of -959, got ${item2.discrepancy}`);
    }

    // C: Run cursor reconciliation with applyFix = true
    console.log('Applying cursor reconciliation fix...');
    reconciliationReport = await reconcileInventoryWithCursor(true);
    item2 = reconciliationReport.find(r => r.product_id === 2);
    console.log(`After reconciliation, Product #2 actual stock: ${item2.actual_stock} (Computed: ${item2.computed_stock})`);
    if (item2.actual_stock !== item2.computed_stock) {
      throw new Error('FAIL: Reconciliation failed to align stock levels.');
    }
    console.log('Success: Cursor stock reconciliation completed.');

    // 9. Test Views
    console.log('\n[TEST 9] Testing Database Views...');
    console.log('Querying v_low_stock_alerts:');
    const alerts = await dbAll('SELECT * FROM v_low_stock_alerts');
    console.table(alerts);
    
    console.log('Querying v_supplier_performance:');
    const performance = await dbAll('SELECT * FROM v_supplier_performance');
    console.table(performance);
    
    console.log('Querying v_stock_valuation:');
    const valuation = await dbAll('SELECT * FROM v_stock_valuation');
    console.table(valuation);

    console.log('\n--- ALL DATABASE UNIT TESTS PASSED SUCCESSFULLY! ---');
    pool.end();
    process.exit(0);

  } catch (err) {
    console.error('\n!!! TEST RUN FAILED WITH ERROR !!!\n', err);
    pool.end();
    process.exit(1);
  }
}

runTests();

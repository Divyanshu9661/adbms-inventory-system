import React, { useState, useEffect } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : '/_/backend/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Data States
  const [stats, setStats] = useState({
    totalValuation: 0,
    totalItems: 0,
    totalProducts: 0,
    lowStockAlertCount: 0,
    activePOCount: 0,
    supplierCount: 0,
    categoryValuation: []
  });
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierPerf, setSupplierPerf] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dbSchema, setDbSchema] = useState({ tables: [], indexes: [], triggers: [], views: [] });
  const [lowStockAlerts, setLowStockAlerts] = useState([]);

  // Loading and Error States
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // SQL Console States
  const [rawSql, setRawSql] = useState('SELECT * FROM products WHERE category = \'Electronics\';');
  const [sqlResult, setSqlResult] = useState(null);
  const [sqlExplain, setSqlExplain] = useState(null);
  const [sqlConsoleError, setSqlConsoleError] = useState('');
  
  // Schema Inspection Detail State
  const [inspectSql, setInspectSql] = useState('');
  const [inspectName, setInspectName] = useState('');

  // Phase 2 states: Cursor & Normalization subtabs
  const [dbaSubTab, setDbaSubTab] = useState('console');
  const [reconcileReport, setReconcileReport] = useState([]);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  // Modal Control States
  const [showProductModal, setShowProductModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showPOModal, setShowPOModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');

  // Form Field States
  const [productForm, setProductForm] = useState({
    sku: '', name: '', description: '', category: 'Electronics', price: '', reorder_level: '10', supplier_id: ''
  });
  const [supplierForm, setSupplierForm] = useState({
    name: '', contact_name: '', email: '', phone: '', address: ''
  });
  const [adjustForm, setAdjustForm] = useState({
    product_id: '', transaction_type: 'IN', quantity: '', notes: ''
  });
  const [poForm, setPoForm] = useState({
    supplier_id: '',
    expected_date: '',
    items: [{ product_id: '', quantity: '', unit_price: '' }]
  });

  // Loaders
  const fetchDashboardStats = () => {
    fetch(`${API_BASE}/dashboard/stats`)
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error('Dashboard load error:', err));
  };

  const fetchProducts = () => {
    fetch(`${API_BASE}/products`)
      .then(res => res.json())
      .then(data => setProducts(data))
      .catch(err => console.error('Products load error:', err));
    fetch(`${API_BASE}/products/low-stock`)
      .then(res => res.json())
      .then(data => setLowStockAlerts(data))
      .catch(err => console.error('Low stock alerts error:', err));
  };

  const fetchSuppliers = () => {
    fetch(`${API_BASE}/suppliers`)
      .then(res => res.json())
      .then(data => {
        setSuppliers(data);
        if (data.length > 0) {
          setProductForm(prev => ({ ...prev, supplier_id: data[0].id.toString() }));
          setPoForm(prev => ({ ...prev, supplier_id: data[0].id.toString() }));
        }
      })
      .catch(err => console.error('Suppliers load error:', err));

    fetch(`${API_BASE}/suppliers/performance`)
      .then(res => res.json())
      .then(data => setSupplierPerf(data))
      .catch(err => console.error('Supplier performance load error:', err));
  };

  const fetchPurchaseOrders = () => {
    fetch(`${API_BASE}/purchase-orders`)
      .then(res => res.json())
      .then(data => setPurchaseOrders(data))
      .catch(err => console.error('Purchase orders load error:', err));
  };

  const fetchTransactions = () => {
    fetch(`${API_BASE}/transactions`)
      .then(res => res.json())
      .then(data => setTransactions(data))
      .catch(err => console.error('Transactions load error:', err));
  };

  const fetchAuditLogs = () => {
    fetch(`${API_BASE}/audit-logs`)
      .then(res => res.json())
      .then(data => setAuditLogs(data))
      .catch(err => console.error('Audit logs load error:', err));
  };

  const fetchDbSchema = () => {
    fetch(`${API_BASE}/db/schema`)
      .then(res => res.json())
      .then(data => {
        setDbSchema(data);
        if (data.tables.length > 0 && !inspectSql) {
          setInspectName(data.tables[0].name);
          setInspectSql(data.tables[0].sql);
        }
      })
      .catch(err => console.error('DB Schema load error:', err));
  };

  const fetchReconciliationReport = () => {
    setReconcileLoading(true);
    fetch(`${API_BASE}/db/reconcile-cursor`)
      .then(res => res.json())
      .then(data => {
        setReconcileReport(data);
        setReconcileLoading(false);
      })
      .catch(err => {
        console.error('Reconciliation report error:', err);
        setReconcileLoading(false);
      });
  };

  const handleRunReconciliationFix = () => {
    setReconcileLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    fetch(`${API_BASE}/db/reconcile-cursor`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSuccessMessage('Inventory discrepancy report successfully resolved via DB Cursor Reconciliation!');
          fetchReconciliationReport();
        } else {
          setErrorMessage(data.error || 'Failed to apply reconciliation fix');
        }
        setReconcileLoading(false);
      })
      .catch(err => {
        setErrorMessage(err.message);
        setReconcileLoading(false);
      });
  };

  // Trigger loads based on active tab
  useEffect(() => {
    setErrorMessage('');
    setSuccessMessage('');
    if (activeTab === 'dashboard') {
      fetchDashboardStats();
      fetchTransactions();
    } else if (activeTab === 'products') {
      fetchProducts();
      fetchSuppliers();
    } else if (activeTab === 'suppliers') {
      fetchSuppliers();
    } else if (activeTab === 'po') {
      fetchPurchaseOrders();
      fetchSuppliers();
      fetchProducts();
    } else if (activeTab === 'dba') {
      fetchDbSchema();
      fetchAuditLogs();
      fetchReconciliationReport();
    }
  }, [activeTab]);

  // Initial load
  useEffect(() => {
    fetchDashboardStats();
    fetchTransactions();
  }, []);

  // Form Submissions
  const handleProductSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');
    fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...productForm,
        price: parseFloat(productForm.price),
        reorder_level: parseInt(productForm.reorder_level),
        supplier_id: parseInt(productForm.supplier_id)
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setErrorMessage(data.error);
        } else {
          setSuccessMessage(`Product '${data.name}' added successfully!`);
          fetchProducts();
          setShowProductModal(false);
          setProductForm({ sku: '', name: '', description: '', category: 'Electronics', price: '', reorder_level: '10', supplier_id: suppliers[0]?.id.toString() || '' });
        }
      })
      .catch(err => setErrorMessage(err.message));
  };

  const handleSupplierSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');
    fetch(`${API_BASE}/suppliers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(supplierForm)
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setErrorMessage(data.error);
        } else {
          setSuccessMessage(`Supplier '${data.name}' registered successfully!`);
          fetchSuppliers();
          setShowSupplierModal(false);
          setSupplierForm({ name: '', contact_name: '', email: '', phone: '', address: '' });
        }
      })
      .catch(err => setErrorMessage(err.message));
  };

  const handleAdjustSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');
    
    const qty = parseInt(adjustForm.quantity);
    const productId = parseInt(adjustForm.product_id || selectedProductId);

    fetch(`${API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId,
        transaction_type: adjustForm.transaction_type,
        quantity: qty,
        notes: adjustForm.notes
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          // Captures custom SQLite check trigger errors!
          setErrorMessage(data.error);
        } else {
          setSuccessMessage(`Stock adjusted successfully!`);
          fetchProducts();
          setShowAdjustModal(false);
          setAdjustForm({ product_id: '', transaction_type: 'IN', quantity: '', notes: '' });
        }
      })
      .catch(err => setErrorMessage(err.message));
  };

  const handlePOSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');

    // Prepare items, convert types
    const formattedItems = poForm.items.map(i => ({
      product_id: parseInt(i.product_id),
      quantity: parseInt(i.quantity),
      unit_price: parseFloat(i.unit_price)
    }));

    fetch(`${API_BASE}/purchase-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplier_id: parseInt(poForm.supplier_id),
        expected_date: poForm.expected_date,
        items: formattedItems
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          // Displays transaction abort / rollback messages
          setErrorMessage(data.error);
        } else {
          setSuccessMessage(`Purchase Order PO-${data.id} created successfully!`);
          fetchPurchaseOrders();
          setShowPOModal(false);
          setPoForm({
            supplier_id: suppliers[0]?.id.toString() || '',
            expected_date: '',
            items: [{ product_id: '', quantity: '', unit_price: '' }]
          });
        }
      })
      .catch(err => setErrorMessage(err.message));
  };

  const handleReceivePO = (poId) => {
    setErrorMessage('');
    setSuccessMessage('');
    fetch(`${API_BASE}/purchase-orders/${poId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DELIVERED' })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setErrorMessage(data.error);
        } else {
          setSuccessMessage(`Purchase Order PO-${poId} fully received. Inventory updated!`);
          fetchPurchaseOrders();
        }
      })
      .catch(err => setErrorMessage(err.message));
  };

  const handleCancelPO = (poId) => {
    setErrorMessage('');
    setSuccessMessage('');
    fetch(`${API_BASE}/purchase-orders/${poId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setErrorMessage(data.error);
        } else {
          setSuccessMessage(`Purchase Order PO-${poId} was cancelled.`);
          fetchPurchaseOrders();
        }
      })
      .catch(err => setErrorMessage(err.message));
  };

  // PO Dynamic Item rows handlers
  const handlePOItemChange = (index, field, value) => {
    const newItems = [...poForm.items];
    newItems[index][field] = value;
    
    // Auto-populate unit price if product is selected
    if (field === 'product_id') {
      const selectedProd = products.find(p => p.id.toString() === value);
      if (selectedProd) {
        newItems[index]['unit_price'] = selectedProd.price.toString();
      }
    }

    setPoForm({ ...poForm, items: newItems });
  };

  const addPOItemRow = () => {
    setPoForm({
      ...poForm,
      items: [...poForm.items, { product_id: '', quantity: '', unit_price: '' }]
    });
  };

  const removePOItemRow = (index) => {
    const newItems = poForm.items.filter((_, i) => i !== index);
    setPoForm({ ...poForm, items: newItems });
  };

  // Raw SQL Console Run
  const handleExecuteSql = () => {
    setSqlConsoleError('');
    setSqlResult(null);
    setSqlExplain(null);

    fetch(`${API_BASE}/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: rawSql })
    })
      .then(res => res.json())
      .then(resData => {
        if (resData.success) {
          setSqlResult(resData.data);
          setSqlExplain(resData.explain);
        } else {
          setSqlConsoleError(resData.error);
        }
      })
      .catch(err => setSqlConsoleError(err.message));
  };

  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">A</div>
          <div className="brand-name">ApexDB Portal</div>
        </div>

        <ul className="nav-links">
          <li className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <span className="nav-item-icon">📊</span> Dashboard
          </li>
          <li className={`nav-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}>
            <span className="nav-item-icon">📦</span> Stock & Products
          </li>
          <li className={`nav-item ${activeTab === 'suppliers' ? 'active' : ''}`} onClick={() => setActiveTab('suppliers')}>
            <span className="nav-item-icon">🤝</span> Suppliers
          </li>
          <li className={`nav-item ${activeTab === 'po' ? 'active' : ''}`} onClick={() => setActiveTab('po')}>
            <span className="nav-item-icon">📝</span> Purchase Orders
          </li>
          <li className={`nav-item ${activeTab === 'dba' ? 'active' : ''}`} onClick={() => setActiveTab('dba')}>
            <span className="nav-item-icon">⚙️</span> Database Admin
          </li>
        </ul>

        <div className="sidebar-footer">
          <div className="db-badge">
            <span className="dot"></span>
            <span>SQLite Active</span>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
            ADBMS Project - 23BAI70096
          </p>
        </div>
      </aside>

      {/* Main View Area */}
      <main className="main-content">
        {errorMessage && (
          <div className="glass-card" style={{ borderColor: 'var(--accent-rose)', background: 'rgba(244,63,94,0.08)', marginBottom: '1.5rem', color: '#FDA4AF', display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
            <div>⚠️ {errorMessage}</div>
            <button onClick={() => setErrorMessage('')} style={{ background: 'none', border: 'none', color: '#FDA4AF', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
          </div>
        )}

        {successMessage && (
          <div className="glass-card" style={{ borderColor: 'var(--accent-emerald)', background: 'rgba(16,185,129,0.08)', marginBottom: '1.5rem', color: '#A7F3D0', display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
            <div>✅ {successMessage}</div>
            <button onClick={() => setSuccessMessage('')} style={{ background: 'none', border: 'none', color: '#A7F3D0', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
          </div>
        )}

        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <>
            <header>
              <div className="header-title">
                <h1>Overview Dashboard</h1>
                <p>Enterprise inventory tracking and active relational metrics.</p>
              </div>
              <button className="btn btn-primary" onClick={() => { 
                if (products.length === 0) fetchProducts();
                setShowAdjustModal(true); 
              }}>
                ⚡ Quick Stock Adjust
              </button>
            </header>

            {/* Metrics */}
            <section className="metrics-grid">
              <div className="metric-card">
                <div className="metric-info">
                  <span className="metric-label">Total Inventory Valuation</span>
                  <span className="metric-value">${stats.totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="metric-subtext">Across {stats.totalProducts} cataloged products</span>
                </div>
                <div className="metric-icon-wrapper" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)' }}>💰</div>
              </div>

              <div className="metric-card">
                <div className="metric-info">
                  <span className="metric-label">Total Items in Stock</span>
                  <span className="metric-value">{stats.totalItems.toLocaleString()}</span>
                  <span className="metric-subtext">Physical units in warehouse</span>
                </div>
                <div className="metric-icon-wrapper" style={{ background: 'rgba(6,182,212,0.1)', color: 'var(--accent-cyan)' }}>📦</div>
              </div>

              <div className="metric-card">
                <div className="metric-info">
                  <span className="metric-label">Low Stock Alerts</span>
                  <span className="metric-value" style={{ color: stats.lowStockAlertCount > 0 ? 'var(--accent-rose)' : 'inherit' }}>
                    {stats.lowStockAlertCount}
                  </span>
                  <span className="metric-subtext">Need urgent procurement</span>
                </div>
                <div className="metric-icon-wrapper" style={{ background: 'rgba(244,63,94,0.1)', color: 'var(--accent-rose)' }}>⚠️</div>
              </div>

              <div className="metric-card">
                <div className="metric-info">
                  <span className="metric-label">Active Purchase Orders</span>
                  <span className="metric-value">{stats.activePOCount}</span>
                  <span className="metric-subtext">In-transit or pending suppliers</span>
                </div>
                <div className="metric-icon-wrapper" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-amber)' }}>📝</div>
              </div>
            </section>

            {/* Charts & Short Ledgers */}
            <div className="split-layout">
              {/* Category Breakdown View */}
              <div className="glass-card">
                <h3 className="section-title">📊 Valuation by Category</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Live aggregate metrics computed from database schema.
                </p>
                <div className="bar-chart">
                  {stats.categoryValuation.map(cat => {
                    const maxVal = Math.max(...stats.categoryValuation.map(c => c.total_valuation), 1);
                    const pct = (cat.total_valuation / maxVal) * 100;
                    return (
                      <div className="bar-row" key={cat.category}>
                        <div className="bar-label">{cat.category}</div>
                        <div className="bar-outer">
                          <div className="bar-inner" style={{ width: `${pct}%` }}></div>
                        </div>
                        <div className="bar-value">${cat.total_valuation.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      </div>
                    );
                  })}
                  {stats.categoryValuation.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>No inventory items available.</div>
                  )}
                </div>
              </div>

              {/* High-level low stock warning */}
              <div className="glass-card">
                <h3 className="section-title">🔔 Low Stock Warnings</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Queried dynamically via <code>v_low_stock_alerts</code> database view.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {lowStockAlerts.slice(0, 4).map(alert => (
                    <div key={alert.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(244,63,94,0.15)' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{alert.product_name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>SKU: {alert.sku} | Supplier: {alert.supplier_name}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className="badge badge-danger">{alert.quantity_in_stock} in stock</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', marginTop: '0.2rem' }}>Order +{alert.recommended_order_qty}</div>
                      </div>
                    </div>
                  ))}
                  {lowStockAlerts.length === 0 && (
                    <div style={{ color: 'var(--accent-emerald)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem', background: 'rgba(16,185,129,0.05)', borderRadius: '8px', border: '1px dashed rgba(16,185,129,0.15)' }}>
                      🎉 Stock levels are excellent! No low stock warnings.
                    </div>
                  )}
                  {lowStockAlerts.length > 4 && (
                    <button onClick={() => setActiveTab('products')} style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.8rem', textAlign: 'left', fontWeight: 'bold' }}>
                      + View all {lowStockAlerts.length} alerts
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Transactions Log */}
            <div className="glass-card">
              <h3 className="section-title">📑 Recent Stock Movements</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>TX ID</th>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Type</th>
                      <th>Quantity</th>
                      <th>Source/Reference</th>
                      <th>Notes</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 5).map(tx => (
                      <tr key={tx.id}>
                        <td><code>#{tx.id}</code></td>
                        <td><strong>{tx.product_name}</strong></td>
                        <td><code>{tx.product_sku}</code></td>
                        <td>
                          <span className={`badge ${tx.transaction_type === 'IN' ? 'badge-success' : tx.transaction_type === 'OUT' ? 'badge-danger' : 'badge-info'}`}>
                            {tx.transaction_type}
                          </span>
                        </td>
                        <td>{tx.quantity} units</td>
                        <td><code>{tx.reference_id}</code></td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{tx.notes}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(tx.transaction_date).toLocaleString()}</td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No stock movements recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: PRODUCTS */}
        {activeTab === 'products' && (
          <>
            <header>
              <div className="header-title">
                <h1>Products & Inventory</h1>
                <p>Register new SKU models, manage categories, and adjust current stock.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={() => {
                  if (products.length > 0) {
                    setSelectedProductId(products[0].id.toString());
                  }
                  setShowAdjustModal(true);
                }}>
                  🔄 Stock Adjustment
                </button>
                <button className="btn btn-primary" onClick={() => setShowProductModal(true)}>
                  ➕ Register Product
                </button>
              </div>
            </header>

            {/* Products Table */}
            <div className="glass-card">
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Product ID</th>
                      <th>SKU</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Quantity In Stock</th>
                      <th>Reorder Point</th>
                      <th>Supplier</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(prod => {
                      const isLowStock = prod.quantity_in_stock <= prod.reorder_level;
                      return (
                        <tr key={prod.id}>
                          <td><code>#{prod.id}</code></td>
                          <td><strong>{prod.sku}</strong></td>
                          <td>
                            <div>
                              <div style={{ fontWeight: 600 }}>{prod.name}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{prod.description}</div>
                            </div>
                          </td>
                          <td>{prod.category}</td>
                          <td><strong>${prod.price.toFixed(2)}</strong></td>
                          <td>
                            <span style={{ 
                              color: isLowStock ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem'
                            }}>
                              {prod.quantity_in_stock}
                              {isLowStock && <span style={{ fontSize: '0.85rem' }}>⚠️</span>}
                            </span>
                          </td>
                          <td>{prod.reorder_level} units</td>
                          <td>{prod.supplier_name || 'N/A'}</td>
                          <td>
                            <span className={`badge ${prod.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>
                              {prod.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 3: SUPPLIERS */}
        {activeTab === 'suppliers' && (
          <>
            <header>
              <div className="header-title">
                <h1>Suppliers Directory</h1>
                <p>Track supplier contact records and inspect calculated SQL metrics.</p>
              </div>
              <button className="btn btn-primary" onClick={() => setShowSupplierModal(true)}>
                ➕ Register Supplier
              </button>
            </header>

            {/* Suppliers Registry */}
            <div className="glass-card" style={{ marginBottom: '2rem' }}>
              <h3 className="section-title">🤝 Partner Profiles</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier ID</th>
                      <th>Company Name</th>
                      <th>Contact Representative</th>
                      <th>Email Address</th>
                      <th>Phone</th>
                      <th>Office Address</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map(sup => (
                      <tr key={sup.id}>
                        <td><code>#{sup.id}</code></td>
                        <td><strong>{sup.name}</strong></td>
                        <td>{sup.contact_name}</td>
                        <td><a href={`mailto:${sup.email}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{sup.email}</a></td>
                        <td>{sup.phone}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{sup.address}</td>
                        <td>
                          <span className={`badge ${sup.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>
                            {sup.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Supplier Performance Metrics (Computed via DB View) */}
            <div className="glass-card">
              <h3 className="section-title">⚙️ Database Calculated Performance Profiles</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Fulfillment rates and delivery speed metrics are generated in real-time by the <code>v_supplier_performance</code> view.
              </p>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier ID</th>
                      <th>Supplier Name</th>
                      <th>Total Orders placed</th>
                      <th>Total Expense Spend</th>
                      <th>Avg Lead Time</th>
                      <th>Fulfillment Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierPerf.map(perf => {
                      const rate = perf.fulfillment_rate;
                      const badgeClass = rate >= 80 ? 'badge-success' : rate >= 50 ? 'badge-warning' : rate !== null ? 'badge-danger' : 'badge-info';
                      return (
                        <tr key={perf.supplier_id}>
                          <td><code>#{perf.supplier_id}</code></td>
                          <td><strong>{perf.supplier_name}</strong></td>
                          <td>{perf.total_orders} orders</td>
                          <td><strong>${perf.total_spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                          <td>{perf.avg_lead_time_days !== null ? `${perf.avg_lead_time_days.toFixed(1)} days` : 'N/A'}</td>
                          <td>
                            <span className={`badge ${badgeClass}`}>
                              {rate !== null ? `${rate.toFixed(0)}%` : 'No Orders'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 4: PURCHASE ORDERS */}
        {activeTab === 'po' && (
          <>
            <header>
              <div className="header-title">
                <h1>Purchase Orders</h1>
                <p>Procure stock from suppliers, process transactions, and track incoming shipments.</p>
              </div>
              <button className="btn btn-primary" onClick={() => {
                if (suppliers.length === 0) fetchSuppliers();
                if (products.length === 0) fetchProducts();
                setShowPOModal(true);
              }}>
                ➕ Create Purchase Order
              </button>
            </header>

            {/* Purchase Orders List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {purchaseOrders.map(po => {
                let statusBadge = 'badge-info';
                if (po.status === 'DELIVERED') statusBadge = 'badge-success';
                if (po.status === 'PENDING') statusBadge = 'badge-warning';
                if (po.status === 'CANCELLED') statusBadge = 'badge-danger';

                return (
                  <div key={po.id} className="glass-card" style={{ padding: '1.5rem', borderLeftWidth: '5px', borderLeftColor: po.status === 'DELIVERED' ? 'var(--accent-emerald)' : po.status === 'PENDING' ? 'var(--accent-amber)' : po.status === 'SHIPPED' ? 'var(--accent-blue)' : 'var(--accent-rose)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{ fontFamily: 'var(--font-title)', fontWeight: 800, fontSize: '1.15rem' }}>PO #{po.id}</span>
                          <span className={`badge ${statusBadge}`}>{po.status}</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          Supplier: <strong>{po.supplier_name}</strong> | Ordered on: {new Date(po.order_date).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Amount</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>${po.total_amount.toFixed(2)}</div>
                      </div>
                    </div>

                    {/* PO Items */}
                    <div className="table-wrapper" style={{ marginBottom: '1rem' }}>
                      <table style={{ fontSize: '0.85rem' }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                            <th style={{ padding: '0.5rem 0.75rem' }}>SKU</th>
                            <th style={{ padding: '0.5rem 0.75rem' }}>Product Name</th>
                            <th style={{ padding: '0.5rem 0.75rem' }}>Unit Price</th>
                            <th style={{ padding: '0.5rem 0.75rem' }}>Qty Ordered</th>
                            <th style={{ padding: '0.5rem 0.75rem' }}>Qty Received</th>
                          </tr>
                        </thead>
                        <tbody>
                          {po.items?.map(item => (
                            <tr key={item.id}>
                              <td style={{ padding: '0.5rem 0.75rem' }}><code>{item.product_sku}</code></td>
                              <td style={{ padding: '0.5rem 0.75rem' }}><strong>{item.product_name}</strong></td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>${item.unit_price.toFixed(2)}</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>{item.quantity} units</td>
                              <td style={{ padding: '0.5rem 0.75rem', color: item.received_quantity === item.quantity ? 'var(--accent-emerald)' : 'inherit' }}>
                                {item.received_quantity} / {item.quantity} units
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* PO Action Buttons */}
                    {(po.status === 'PENDING' || po.status === 'SHIPPED') && (
                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleCancelPO(po.id)}>
                          Cancel Order
                        </button>
                        <button className="btn btn-primary btn-sm" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleReceivePO(po.id)}>
                          📥 Receive Shipment & Update Stock
                        </button>
                      </div>
                    )}
                    {po.status === 'DELIVERED' && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'flex-end' }}>
                        <span>✓ Inventory updated via DBMS Triggers on {new Date(po.delivery_date).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {purchaseOrders.length === 0 && (
                <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No Purchase Orders recorded. Let's create one!
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 5: DATABASE ADMIN (ADBMS VIEW) */}
        {activeTab === 'dba' && (
          <>
            <header>
              <div className="header-title">
                <h1>ADBMS Engine Diagnostics</h1>
                <p>Analyze schema objects, examine trigger-populated audit trails, run SQL explains, and explore normalization.</p>
              </div>
            </header>

            {/* DBA Sub Navigation */}
            <div className="dba-tabs">
              <div className={`dba-tab ${dbaSubTab === 'console' ? 'active' : ''}`} onClick={() => setDbaSubTab('console')}>
                💻 SQL Query Console
              </div>
              <div className={`dba-tab ${dbaSubTab === 'schema' ? 'active' : ''}`} onClick={() => setDbaSubTab('schema')}>
                💾 Schema Inspector
              </div>
              <div className={`dba-tab ${dbaSubTab === 'audit' ? 'active' : ''}`} onClick={() => setDbaSubTab('audit')}>
                📑 Trigger Audit Logs
              </div>
              <div className={`dba-tab ${dbaSubTab === 'reconcile' ? 'active' : ''}`} onClick={() => { setDbaSubTab('reconcile'); fetchReconciliationReport(); }}>
                🔄 Cursor Reconciliation
              </div>
              <div className={`dba-tab ${dbaSubTab === 'normalization' ? 'active' : ''}`} onClick={() => setDbaSubTab('normalization')}>
                📐 Normalization Theory
              </div>
            </div>

            {/* SUBTAB 1: SQL QUERY CONSOLE */}
            {dbaSubTab === 'console' && (
              <div className="glass-card">
                <h3 className="section-title">💻 SQL Query Analyzer Console</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Write any SQL query. If it is a <code>SELECT</code> statement, the engine will automatically parse and output the **Query Execution Plan** below the results.
                </p>
                <div className="sql-editor-container">
                  <textarea 
                    className="sql-textarea"
                    value={rawSql}
                    onChange={(e) => setRawSql(e.target.value)}
                    placeholder="SELECT * FROM products;"
                  />
                  <div style={{ display: 'flex', justify: 'space-between', gap: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      💡 Use composite indexes or joins to test the SQLite query cost planner.
                    </div>
                    <button className="btn btn-primary" onClick={handleExecuteSql}>
                      🚀 Run Query Analyzer
                    </button>
                  </div>
                </div>

                {sqlConsoleError && (
                  <div className="sql-code" style={{ color: '#F43F5E', background: 'rgba(244,63,94,0.05)', borderColor: 'rgba(244,63,94,0.15)', borderWidth: '1px', borderStyle: 'solid', marginTop: '1rem' }}>
                    Error: {sqlConsoleError}
                  </div>
                )}

                {sqlResult && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: '#fff' }}>Query Outputs:</h4>
                    <div className="table-wrapper" style={{ maxHeight: '250px', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '8px' }}>
                      {Array.isArray(sqlResult) ? (
                        sqlResult.length > 0 ? (
                          <table style={{ fontSize: '0.8rem' }}>
                            <thead>
                              <tr>
                                {Object.keys(sqlResult[0]).map(key => <th key={key} style={{ padding: '0.5rem' }}>{key}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {sqlResult.map((row, idx) => (
                                <tr key={idx}>
                                  {Object.values(row).map((val, vidx) => (
                                    <td key={vidx} style={{ padding: '0.5rem', color: val === null ? 'var(--text-muted)' : 'inherit' }}>
                                      {val === null ? 'NULL' : typeof val === 'object' ? JSON.stringify(val) : val.toString()}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem' }}>Query returned 0 rows.</div>
                        )
                      ) : (
                        <div style={{ color: 'var(--accent-emerald)', padding: '0.5rem', fontWeight: 'bold' }}>
                          {JSON.stringify(sqlResult, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Show SQL execution plan for SELECT statements */}
                {sqlExplain && (
                  <div className="analysis-container">
                    <div className="analysis-title">
                      <span>🔍 SQL Execution Plan Analysis</span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      Extracted directly from SQLite using <code>EXPLAIN QUERY PLAN</code>. Explains scan operations and index usage.
                    </p>
                    <div className="table-wrapper" style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '8px' }}>
                      <table className="explain-plan-table">
                        <thead>
                          <tr>
                            <th>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sqlExplain.map((row, idx) => (
                            <tr key={idx}>
                              <td style={{ color: row.detail.includes('USING INDEX') || row.detail.includes('USING COVERING INDEX') ? '#34D399' : '#F87171' }}>
                                {row.detail}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                      <span style={{ color: '#34D399' }}>● Index Search</span> (Fast, O(log N))
                      <span style={{ color: '#F87171' }}>● Full Table Scan</span> (Slow, O(N))
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SUBTAB 2: SCHEMA INSPECTOR */}
            {dbaSubTab === 'schema' && (
              <div className="split-layout" style={{ gridTemplateColumns: '1.2fr 0.8fr', alignItems: 'start' }}>
                <div className="glass-card">
                  <h3 className="section-title">💾 System Schema Objects</h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    
                    {/* Tables list */}
                    <div>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Tables</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {dbSchema.tables.map(t => (
                          <span key={t.name} className={`badge ${inspectName === t.name ? 'badge-info' : 'badge-secondary'}`} style={{ cursor: 'pointer' }} onClick={() => { setInspectName(t.name); setInspectSql(t.sql); }}>
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Views list */}
                    <div>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Views</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {dbSchema.views.map(v => (
                          <span key={v.name} className={`badge ${inspectName === v.name ? 'badge-success' : 'badge-secondary'}`} style={{ cursor: 'pointer' }} onClick={() => { setInspectName(v.name); setInspectSql(v.sql); }}>
                            {v.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Triggers list */}
                    <div>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>DBMS Triggers</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {dbSchema.triggers.map(tr => (
                          <span key={tr.name} className={`badge ${inspectName === tr.name ? 'badge-danger' : 'badge-secondary'}`} style={{ cursor: 'pointer' }} onClick={() => { setInspectName(tr.name); setInspectSql(tr.sql); }}>
                            {tr.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Indexes list */}
                    <div>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Indexes</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {dbSchema.indexes.map(ind => (
                          <span key={ind.name} className={`badge ${inspectName === ind.name ? 'badge-warning' : 'badge-secondary'}`} style={{ cursor: 'pointer' }} onClick={() => { setInspectName(ind.name); setInspectSql(ind.sql); }}>
                            {ind.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {inspectSql && (
                  <div className="glass-card">
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>DDL Statement for: {inspectName}</div>
                    <pre className="sql-code" style={{ fontSize: '0.75rem', padding: '0.75rem' }}>{inspectSql}</pre>
                  </div>
                )}
              </div>
            )}

            {/* SUBTAB 3: TRIGGER AUDIT LOGS */}
            {dbaSubTab === 'audit' && (
              <div className="glass-card">
                <h3 className="section-title">📑 System Transaction Audit Log</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  This ledger is written automatically by SQL <code>AFTER UPDATE</code> triggers when products or purchase orders change state.
                </p>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Audit ID</th>
                        <th>Target Table</th>
                        <th>Action</th>
                        <th>Record ID</th>
                        <th>Prior State (JSON)</th>
                        <th>New State (JSON)</th>
                        <th>Responsible Actor</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map(log => (
                        <tr key={log.id}>
                          <td><code>#{log.id}</code></td>
                          <td><span className="badge badge-info">{log.table_name}</span></td>
                          <td>
                            <span className={`badge ${log.action_type === 'INSERT' ? 'badge-success' : log.action_type === 'UPDATE' ? 'badge-warning' : 'badge-danger'}`}>
                              {log.action_type}
                            </span>
                          </td>
                          <td><code>#{log.record_id}</code></td>
                          <td><pre style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{JSON.stringify(JSON.parse(log.old_values), null, 2)}</pre></td>
                          <td><pre style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{JSON.stringify(JSON.parse(log.new_values), null, 2)}</pre></td>
                          <td><code>{log.changed_by}</code></td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(log.changed_at).toLocaleString()}</td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No audit transactions recorded yet. Modify products or POs to fire triggers.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUBTAB 4: CURSOR RECONCILIATION */}
            {dbaSubTab === 'reconcile' && (
              <div className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <h3 className="section-title" style={{ margin: 0 }}>🔄 Cursor-Based Stock Reconciliation</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                      Uses a row-by-row database cursor (via streaming <code>db.each</code>) to trace all past stock transactions and compare them to the cached table stock.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-secondary" onClick={fetchReconciliationReport} disabled={reconcileLoading}>
                      {reconcileLoading ? 'Auditing...' : '🔄 Run Cursor Audit'}
                    </button>
                    {reconcileReport.some(r => r.discrepancy !== 0) && (
                      <button className="btn btn-primary" onClick={handleRunReconciliationFix} disabled={reconcileLoading}>
                        ⚡ Run Cursor Repair
                      </button>
                    )}
                  </div>
                </div>

                {reconcileReport.some(r => r.discrepancy !== 0) ? (
                  <div className="badge badge-danger" style={{ display: 'block', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.9rem', border: '1px solid rgba(244,63,94,0.3)', width: '100%', textAlign: 'left' }}>
                    ⚠️ <strong>Discrepancy Warning:</strong> The database engine has detected stock mismatch anomalies where the transaction ledgers do not align with product cached levels. Run Cursor Repair to perform a row-by-row correction transaction.
                  </div>
                ) : (
                  <div className="badge badge-success" style={{ display: 'block', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.9rem', border: '1px solid rgba(16,185,129,0.3)', width: '100%', textAlign: 'left' }}>
                    ✓ <strong>Database Integrity:</strong> All product stock levels match their transaction ledgers.
                  </div>
                )}

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Product ID</th>
                        <th>SKU</th>
                        <th>Product Name</th>
                        <th>Table Cached Stock</th>
                        <th>Cursor Calculated Stock</th>
                        <th>Discrepancy</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileReport.map(row => {
                        const hasAnomaly = row.discrepancy !== 0;
                        return (
                          <tr key={row.product_id} style={{ background: hasAnomaly ? 'rgba(244,63,94,0.03)' : 'transparent' }}>
                            <td><code>#{row.product_id}</code></td>
                            <td><strong>{row.sku}</strong></td>
                            <td>{row.name}</td>
                            <td><strong>{row.actual_stock} units</strong></td>
                            <td><strong>{row.computed_stock} units</strong></td>
                            <td style={{ color: hasAnomaly ? 'var(--accent-rose)' : 'var(--accent-emerald)', fontWeight: 'bold' }}>
                              {hasAnomaly ? `${row.discrepancy > 0 ? '+' : ''}${row.discrepancy}` : '0'}
                            </td>
                            <td>
                              <span className={`badge ${hasAnomaly ? 'badge-danger' : 'badge-success'}`}>
                                {hasAnomaly ? 'Discrepancy' : 'Matched'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUBTAB 5: NORMALIZATION THEORY */}
            {dbaSubTab === 'normalization' && (
              <div className="glass-card">
                <h3 className="section-title">📐 Schema Normalization Analyzer (Up to 3NF)</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Analyzing normalization levels and functional dependencies (FDs) to prevent insertion, update, and deletion anomalies.
                </p>

                {/* Normalization cards grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                  
                  <div className="schema-item" style={{ cursor: 'default' }}>
                    <div className="schema-item-header">
                      <span className="schema-item-name" style={{ color: 'var(--accent-cyan)' }}>1NF: First Normal Form</span>
                      <span className="badge badge-success" style={{ background: 'rgba(6,182,212,0.1)' }}>Verified</span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5', marginTop: '0.5rem' }}>
                      <strong>Rule:</strong> Atomic values (no multi-valued/repeating fields), and defined Primary Keys.
                      <br /><br />
                      <strong>Application:</strong> E.g. rather than storing line items as a JSON list in <code>purchase_orders</code>, we normalized items into <code>purchase_order_items</code>.
                    </p>
                  </div>

                  <div className="schema-item" style={{ cursor: 'default' }}>
                    <div className="schema-item-header">
                      <span className="schema-item-name" style={{ color: 'var(--accent-blue)' }}>2NF: Second Normal Form</span>
                      <span className="badge badge-success" style={{ background: 'rgba(59,130,246,0.1)' }}>Verified</span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5', marginTop: '0.5rem' }}>
                      <strong>Rule:</strong> Meets 1NF, and has no partial functional dependencies (all non-key fields depend on the *entire* Primary Key).
                      <br /><br />
                      <strong>Application:</strong> In <code>purchase_order_items</code>, attributes like <code>quantity</code> depend fully on the composite key (order_id, product_id) represented by our PK.
                    </p>
                  </div>

                  <div className="schema-item" style={{ cursor: 'default' }}>
                    <div className="schema-item-header">
                      <span className="schema-item-name" style={{ color: 'var(--accent-emerald)' }}>3NF: Third Normal Form</span>
                      <span className="badge badge-success" style={{ background: 'rgba(16,185,129,0.1)' }}>Verified</span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5', marginTop: '0.5rem' }}>
                      <strong>Rule:</strong> Meets 2NF, and contains no transitive functional dependencies (no non-key field depends on another non-key field).
                      <br /><br />
                      <strong>Application:</strong> Moving supplier phone/address out of <code>products</code> into <code>suppliers</code>. The supplier details depend on <code>supplier_id</code>, which is a foreign key on product.
                    </p>
                  </div>

                </div>

                {/* Functional Dependencies Table */}
                <h4 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.75rem' }}>Functional Dependencies & Candidate Keys:</h4>
                <div className="table-wrapper" style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '0.5rem', marginBottom: '2rem' }}>
                  <table style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Table Name</th>
                        <th>Candidate Keys</th>
                        <th>Primary Key</th>
                        <th>Functional Dependencies (FDs)</th>
                        <th>Normal Form</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><code>suppliers</code></td>
                        <td><code>{'{id}'}</code>, <code>{'{email}'}</code></td>
                        <td><code>id</code></td>
                        <td>
                          <code>id → name, contact_name, email, phone, address, status</code><br />
                          <code>email → id, name, contact_name, phone, address, status</code>
                        </td>
                        <td><span className="badge badge-success">3NF / BCNF</span></td>
                      </tr>
                      <tr>
                        <td><code>products</code></td>
                        <td><code>{'{id}'}</code>, <code>{'{sku}'}</code></td>
                        <td><code>id</code></td>
                        <td>
                          <code>id → sku, name, description, category, price, quantity_in_stock, reorder_level, supplier_id, status</code><br />
                          <code>sku → id, name, description, category, price, quantity_in_stock, reorder_level, supplier_id, status</code>
                        </td>
                        <td><span className="badge badge-success">3NF / BCNF</span></td>
                      </tr>
                      <tr>
                        <td><code>purchase_orders</code></td>
                        <td><code>{'{id}'}</code></td>
                        <td><code>id</code></td>
                        <td><code>id → supplier_id, order_date, expected_date, delivery_date, total_amount, status</code></td>
                        <td><span className="badge badge-success">3NF</span></td>
                      </tr>
                      <tr>
                        <td><code>purchase_order_items</code></td>
                        <td><code>{'{id}'}</code></td>
                        <td><code>id</code></td>
                        <td><code>id → order_id, product_id, quantity, unit_price, received_quantity</code></td>
                        <td><span className="badge badge-success">3NF</span></td>
                      </tr>
                      <tr>
                        <td><code>stock_transactions</code></td>
                        <td><code>{'{id}'}</code></td>
                        <td><code>id</code></td>
                        <td><code>id → product_id, transaction_type, quantity, reference_id, notes, transaction_date</code></td>
                        <td><span className="badge badge-success">3NF</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Insertion/Update/Deletion Anomalies Check */}
                <h4 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.75rem' }}>DBMS Anomaly Prevention Details:</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <strong>Update Anomaly:</strong> If we stored supplier email in the products table, updating a supplier's email would require updating multiple rows in the products table. Normalization resolves this by storing it in a single row in <code>suppliers</code>.
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <strong>Insertion Anomaly:</strong> We cannot add a new supplier without creating a dummy product if supplier data was stored in the products table. Separating tables lets us register suppliers before cataloging products.
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <strong>Deletion Anomaly:</strong> Deleting all product items for a specific brand would delete the supplier profile from the database if they were coupled. Normalization prevents this loss of data.
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* MODAL 1: REGISTER PRODUCT */}
        {showProductModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h2>Register New Product</h2>
                <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }} onClick={() => setShowProductModal(false)}>✕</button>
              </div>
              <form onSubmit={handleProductSubmit}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Product SKU (Unique identifier, e.g. ELEC-MON-301)</label>
                    <input 
                      type="text" 
                      required 
                      value={productForm.sku} 
                      onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                      placeholder="ELEC-MON-301"
                    />
                  </div>

                  <div className="form-group">
                    <label>Product Name</label>
                    <input 
                      type="text" 
                      required 
                      value={productForm.name} 
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      placeholder="Liquid Crystal Display 27 inch"
                    />
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <textarea 
                      value={productForm.description} 
                      onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                      placeholder="Enter specifications or model description..."
                    />
                  </div>

                  <div className="split-layout" style={{ gridTemplateColumns: '1fr 1fr', margin: 0, gap: '1rem' }}>
                    <div className="form-group">
                      <label>Category</label>
                      <select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}>
                        <option value="Electronics">Electronics</option>
                        <option value="Office Supplies">Office Supplies</option>
                        <option value="Packaging">Packaging</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Default Supplier</label>
                      <select value={productForm.supplier_id} onChange={(e) => setProductForm({ ...productForm, supplier_id: e.target.value })}>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="split-layout" style={{ gridTemplateColumns: '1fr 1fr', margin: 0, gap: '1rem' }}>
                    <div className="form-group">
                      <label>Price ($ USD)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        required 
                        min="0"
                        value={productForm.price} 
                        onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                        placeholder="199.99"
                      />
                    </div>

                    <div className="form-group">
                      <label>Reorder Point Threshold (Units)</label>
                      <input 
                        type="number" 
                        required 
                        min="0"
                        value={productForm.reorder_level} 
                        onChange={(e) => setProductForm({ ...productForm, reorder_level: e.target.value })}
                        placeholder="10"
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowProductModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Product Model</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: REGISTER SUPPLIER */}
        {showSupplierModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h2>Register New Supplier Partner</h2>
                <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }} onClick={() => setShowSupplierModal(false)}>✕</button>
              </div>
              <form onSubmit={handleSupplierSubmit}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Company/Supplier Name</label>
                    <input 
                      type="text" 
                      required 
                      value={supplierForm.name} 
                      onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                      placeholder="Apex Tech Logistics"
                    />
                  </div>

                  <div className="form-group">
                    <label>Contact Representative Name</label>
                    <input 
                      type="text" 
                      required 
                      value={supplierForm.contact_name} 
                      onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })}
                      placeholder="Jane Doe"
                    />
                  </div>

                  <div className="form-group">
                    <label>Email Address</label>
                    <input 
                      type="email" 
                      required 
                      value={supplierForm.email} 
                      onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                      placeholder="orders@apextech.com"
                    />
                  </div>

                  <div className="form-group">
                    <label>Phone Number</label>
                    <input 
                      type="text" 
                      required 
                      value={supplierForm.phone} 
                      onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                      placeholder="+1-555-9080"
                    />
                  </div>

                  <div className="form-group">
                    <label>Office Address</label>
                    <textarea 
                      required 
                      value={supplierForm.address} 
                      onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                      placeholder="100 Enterprise Way, Suite 400, Austin, TX"
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowSupplierModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Supplier Profile</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 3: CREATE PURCHASE ORDER */}
        {showPOModal && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '750px' }}>
              <div className="modal-header">
                <h2>Create Purchase Order (ACID Wrapper)</h2>
                <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }} onClick={() => setShowPOModal(false)}>✕</button>
              </div>
              <form onSubmit={handlePOSubmit}>
                <div className="modal-body">
                  <div className="split-layout" style={{ gridTemplateColumns: '1.2fr 0.8fr', margin: 0, gap: '1rem' }}>
                    <div className="form-group">
                      <label>Select Supplier Partner</label>
                      <select value={poForm.supplier_id} onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })}>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Expected Delivery Date</label>
                      <input 
                        type="date" 
                        value={poForm.expected_date} 
                        onChange={(e) => setPoForm({ ...poForm, expected_date: e.target.value })}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>Order Line Items</span>
                      <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={addPOItemRow}>
                        ➕ Add Line Item
                      </button>
                    </div>

                    <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                      {poForm.items.map((item, index) => (
                        <div key={index} className="po-item-row">
                          <div className="flex-grow-1">
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Product SKU</label>
                            <select 
                              required
                              value={item.product_id} 
                              onChange={(e) => handlePOItemChange(index, 'product_id', e.target.value)}
                              style={{ padding: '0.5rem' }}
                            >
                              <option value="">-- Choose Product --</option>
                              {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                            </select>
                          </div>

                          <div style={{ width: '100px' }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Quantity</label>
                            <input 
                              type="number" 
                              required 
                              min="1" 
                              value={item.quantity} 
                              onChange={(e) => handlePOItemChange(index, 'quantity', e.target.value)}
                              style={{ padding: '0.5rem' }}
                              placeholder="10"
                            />
                          </div>

                          <div style={{ width: '130px' }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Unit Cost ($)</label>
                            <input 
                              type="number" 
                              required 
                              min="0"
                              step="0.01" 
                              value={item.unit_price} 
                              onChange={(e) => handlePOItemChange(index, 'unit_price', e.target.value)}
                              style={{ padding: '0.5rem' }}
                              placeholder="0.00"
                            />
                          </div>

                          {poForm.items.length > 1 && (
                            <button 
                              type="button" 
                              className="btn btn-danger btn-icon" 
                              style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => removePOItemRow(index)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowPOModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Process PO Transaction</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 4: QUICK ADJUST STOCK */}
        {showAdjustModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h2>Quick Stock Adjustment</h2>
                <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }} onClick={() => setShowAdjustModal(false)}>✕</button>
              </div>
              <form onSubmit={handleAdjustSubmit}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Select Product SKU</label>
                    <select 
                      value={adjustForm.product_id || selectedProductId} 
                      onChange={(e) => {
                        setSelectedProductId(e.target.value);
                        setAdjustForm({ ...adjustForm, product_id: e.target.value });
                      }}
                    >
                      {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name} (Current: {p.quantity_in_stock})</option>)}
                    </select>
                  </div>

                  <div className="split-layout" style={{ gridTemplateColumns: '1fr 1fr', margin: 0, gap: '1rem' }}>
                    <div className="form-group">
                      <label>Adjustment Direction</label>
                      <select value={adjustForm.transaction_type} onChange={(e) => setAdjustForm({ ...adjustForm, transaction_type: e.target.value })}>
                        <option value="IN">IN (Receive / Add)</option>
                        <option value="OUT">OUT (Fulfill / Deduct)</option>
                        <option value="ADJUSTMENT">ADJUSTMENT (Audit count discrepancy)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Quantity Change (Positive units)</label>
                      <input 
                        type="number" 
                        required 
                        min="1" 
                        value={adjustForm.quantity} 
                        onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                        placeholder="5"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Adjustment Notes / Reference</label>
                    <input 
                      type="text" 
                      value={adjustForm.notes} 
                      onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                      placeholder="Stock count discrepancy correction"
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAdjustModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Process Stock Update</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

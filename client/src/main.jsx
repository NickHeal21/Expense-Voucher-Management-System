import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const tokenKey = 'pspl_auth_token';
const home = { employee: '/employee', director: '/director', accounts: '/accounts' };

async function api(path, options = {}) {
  const headers = { Authorization: `Bearer ${localStorage.getItem(tokenKey) || ''}`, ...options.headers };
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, { ...options, headers, body });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState(window.location.pathname);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState('');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);

  function navigate(path, replace = false) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(path);
    setNotice('');
  }

  useEffect(() => {
    const token = localStorage.getItem(tokenKey);
    if (!token) { setChecking(false); return; }
    api('/auth/me').then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem(tokenKey))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (checking) return;
    if (!user) {
      if (route !== '/login') navigate('/login', true);
      return;
    }
    const roleHome = home[user.role];
    if (!roleHome || (route !== roleHome && !route.startsWith(`${roleHome}/`))) {
      navigate(roleHome, true);
      return;
    }
    const segments = route.split('/').filter(Boolean);
    const section = segments[1] || 'dashboard';
    const allowed = section === 'dashboard' || section === 'vouchers' ||
      (section === 'approvals' && user.role === 'director');
    if (!allowed) navigate(roleHome, true);
  }, [checking, route, user]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setLoginError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/auth/login', {
        method: 'POST', body: { email: form.get('email'), password: form.get('password') },
      });
      localStorage.setItem(tokenKey, data.token);
      setUser(data.user);
      navigate(home[data.user.role]);
    } catch (error) { setLoginError(error.message); }
    finally { setBusy(false); }
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    setUser(null);
    navigate('/login');
  }

  if (checking) return <main className="page"><p>Loading your session…</p></main>;
  if (!user) return <Login onSubmit={login} busy={busy} error={loginError} />;

  const roleBase = home[user.role];
  const parts = route.split('/').filter(Boolean);
  const page = parts[1] || 'dashboard';
  const id = parts[2] || null;
  let content;

  if (page === 'vouchers' && id === 'new' && user.role === 'employee') {
    content = <VoucherForm key="new" user={user} onDone={navigate} setNotice={setNotice} />;
  } else if (page === 'vouchers' && id && id !== 'new') {
    if (parts[3] === 'edit' && user.role === 'employee') {
      content = <VoucherForm key={id} user={user} id={id} onDone={navigate} setNotice={setNotice} />;
    } else {
      content = <VoucherDetails key={`${user.role}-${id}`} id={id} user={user} navigate={navigate} setNotice={setNotice} />;
    }
  } else if (page === 'vouchers' || page === 'approvals') {
    content = <VoucherList key={page} user={user} navigate={navigate} approvalsOnly={page === 'approvals'} />;
  } else if (page === 'dashboard') {
    content = <Dashboard key={user.role} user={user} navigate={navigate} />;
  } else {
    content = <p>Loading…</p>;
  }

  const navItems = user.role === 'employee'
    ? [['Dashboard', roleBase], ['My vouchers', `${roleBase}/vouchers`]]
    : user.role === 'director'
      ? [['Dashboard', roleBase], ['All vouchers', `${roleBase}/vouchers`], ['Pending approvals', `${roleBase}/approvals`]]
      : [['Dashboard', roleBase], ['All vouchers', `${roleBase}/vouchers`]];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><span className="brand">PSPL</span><span className="brand-title">Expense Voucher Management</span></div>
        <div className="account"><span>{user.fullName} · {user.role}</span><button className="link-button" onClick={logout}>Log out</button></div>
      </header>
      <div className="layout">
        <nav className="sidebar" aria-label="Main navigation">
          {navItems.map(([label, path]) => <button key={path} className={route === path ? 'nav-item active' : 'nav-item'} onClick={() => navigate(path)}>{label}</button>)}
        </nav>
        <main className="main-content">
          {notice && <p className="success" role="status">{notice}</p>}
          {content}
        </main>
      </div>
    </div>
  );
}

function Login({ onSubmit, busy, error }) {
  return <main className="page"><section className="card login-card">
    <p className="eyebrow">Prachay Securities Private Limited</p>
    <h1>Expense Voucher Management System</h1>
    <p className="muted">Sign in to access your expense voucher workspace.</p>
    <form className="form-stack" onSubmit={onSubmit}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </section></main>;
}

function Dashboard({ user, navigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/vouchers/dashboard').then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorMessage message={error} />;
  if (!data) return <Loading />;
  const stats = data.stats;
  const items = user.role === 'employee'
    ? [['Total vouchers', stats.total_vouchers], ['Drafts', stats.drafts], ['Pending approvals', stats.pending], ['Approved', stats.approved], ['Rejected', stats.rejected], ['Total amount claimed', money(stats.total_amount)]]
    : user.role === 'director'
      ? [['Pending approval', stats.pending], ['Approved today', stats.approved_today], ['Rejected today', stats.rejected_today], ['Amount awaiting approval', money(stats.pending_amount)]]
      : [['Total vouchers', stats.total_vouchers], ['Pending approvals', stats.pending], ['Approved', stats.approved], ['Rejected', stats.rejected], ['Approved expense amount', money(stats.approved_amount)]];
  return <>
    <div className="page-heading"><div><p className="eyebrow">{user.role} workspace</p><h1>Dashboard</h1></div>
      {user.role === 'employee' && <button onClick={() => navigate('/employee/vouchers/new')}>Create voucher</button>}
      {user.role === 'director' && <SignaturePanel role="director" />}
    </div>
    <div className="stats-grid">{items.map(([label, value]) => <article className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <section className="section-card"><div className="section-heading"><h2>{user.role === 'accounts' ? 'Recent approved vouchers' : user.role === 'director' ? 'Recent voucher activity' : 'Recent vouchers'}</h2>
      <button className="secondary-button" onClick={() => navigate(user.role === 'director' ? '/director/approvals' : `${home[user.role]}/vouchers`)}>View vouchers</button></div>
      <VoucherTable vouchers={user.role === 'accounts' ? data.recent.filter((v) => v.status === 'approved') : data.recent} navigate={navigate} role={user.role} />
    </section>
  </>;
}

function VoucherList({ user, navigate, approvalsOnly }) {
  const [vouchers, setVouchers] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: approvalsOnly ? 'pending_approval' : '', department: '', category: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '', sort: 'newest' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load(nextFilters = filters) {
    setLoading(true); setError('');
    const query = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value !== ''));
    try { const result = await api(`/vouchers?${query}`); setVouchers(result.vouchers); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(filters); }, []);
  function change(event) { setFilters({ ...filters, [event.target.name]: event.target.value }); }
  return <>
    <div className="page-heading"><div><p className="eyebrow">{user.role === 'employee' ? 'Employee' : user.role === 'director' ? 'Director' : 'Accounts'}</p><h1>{approvalsOnly ? 'Pending approvals' : user.role === 'employee' ? 'My vouchers' : 'All vouchers'}</h1></div>
      {user.role === 'employee' && <button onClick={() => navigate('/employee/vouchers/new')}>Create voucher</button>}
    </div>
    {user.role === 'employee' && <SignaturePanel role="employee" />}
    {user.role === 'director' && <SignaturePanel role="director" />}
    <form className="filter-card" onSubmit={(e) => { e.preventDefault(); load(filters); }}>
      <label className="wide-field">Search<input name="search" value={filters.search} onChange={change} placeholder="Voucher number, title, employee…" /></label>
      <label>Status<select name="status" value={filters.status} onChange={change}><option value="">All statuses</option>{['draft','pending_approval','approved','rejected'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <label>Department<input name="department" value={filters.department} onChange={change} /></label>
      <label>Category<input name="category" value={filters.category} onChange={change} /></label>
      {user.role !== 'employee' && <label>Employee<input name="employee" value={filters.employee || ''} onChange={change} /></label>}
      <label>From date<input type="date" name="dateFrom" value={filters.dateFrom} onChange={change} /></label>
      <label>To date<input type="date" name="dateTo" value={filters.dateTo} onChange={change} /></label>
      <label>Min amount<input type="number" min="0.01" step="0.01" name="amountMin" value={filters.amountMin} onChange={change} /></label>
      <label>Max amount<input type="number" min="0.01" step="0.01" name="amountMax" value={filters.amountMax} onChange={change} /></label>
      <label>Sort<select name="sort" value={filters.sort} onChange={change}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest amount</option><option value="lowest">Lowest amount</option></select></label>
      <button type="submit">Apply filters</button>
    </form>
    {error && <ErrorMessage message={error} />}
    <section className="section-card">{loading ? <Loading /> : <VoucherTable vouchers={vouchers} navigate={navigate} role={user.role} />}</section>
  </>;
}

function VoucherTable({ vouchers, navigate, role }) {
  if (!vouchers?.length) return <p className="empty-state">No vouchers to display.</p>;
  return <div className="table-wrap"><table><thead><tr><th>Voucher</th><th>Expense</th>{role !== 'employee' && <th>Employee</th>}<th>Expense date</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead>
    <tbody>{vouchers.map((v) => <tr key={v.id}><td>#{v.voucher_number}</td><td>{v.expense_title || v.description}</td>{role !== 'employee' && <td>{v.employee_name}</td>}<td>{date(v.expense_date)}</td><td>{money(v.amount)}</td><td><span className={`badge ${v.status}`}>{statusLabel(v.status)}</span></td><td>{date(v.created_at)}</td><td><button className="text-button" onClick={() => navigate(`${home[role]}/vouchers/${v.id}`)}>View</button></td></tr>)}</tbody></table></div>;
}

function VoucherForm({ user, id, onDone, setNotice }) {
  const [form, setForm] = useState({ voucher_date: new Date().toISOString().slice(0, 10), expense_date: new Date().toISOString().slice(0, 10), department: '', expense_title: '', category: '', description: '', amount: '' });
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => { if (!id) return; api(`/vouchers/${id}`).then(({ voucher }) => {
    if (voucher.status !== 'draft') { setReadOnly(true); return; }
    setForm({ voucher_date: String(voucher.voucher_date).slice(0, 10), expense_date: String(voucher.expense_date).slice(0, 10), department: voucher.department || '', expense_title: voucher.expense_title || '', category: voucher.category, description: voucher.description, amount: voucher.amount });
  }).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [id]);
  function change(event) { setForm({ ...form, [event.target.name]: event.target.value }); }
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const { voucher } = await api(id ? `/vouchers/${id}` : '/vouchers', { method: id ? 'PUT' : 'POST', body: form });
      onDone(`/employee/vouchers/${voucher.id}`);
      setNotice(`Draft voucher #${voucher.voucher_number} saved.`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  if (loading) return <Loading />;
  if (readOnly) return <><ErrorMessage message="Only draft vouchers can be edited." /><button onClick={() => onDone(`/employee/vouchers/${id}`)}>View voucher</button></>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Employee</p><h1>{id ? 'Edit draft voucher' : 'Create voucher'}</h1></div></div>
    <form className="section-card form-grid" onSubmit={save}>
      {error && <p className="error full-width" role="alert">{error}</p>}
      <label>Employee<input value={`${user.fullName} (${user.email})`} disabled /></label>
      <label>Voucher date<input type="date" value={form.voucher_date} disabled /></label>
      <label>Expense date<input type="date" name="expense_date" value={form.expense_date} onChange={change} required /></label>
      <label>Department<input name="department" value={form.department} onChange={change} maxLength="120" required /></label>
      <label>Expense title<input name="expense_title" value={form.expense_title} onChange={change} maxLength="200" required /></label>
      <label>Expense category<input name="category" value={form.category} onChange={change} maxLength="120" required /></label>
      <label>Amount<input type="number" name="amount" value={form.amount} onChange={change} min="0.01" max="9999999999.99" step="0.01" required /></label>
      <label className="full-width">Expense description<textarea name="description" value={form.description} onChange={change} maxLength="4000" rows="4" required /></label>
      <div className="full-width"><SignaturePanel role="employee" /></div>
      <div className="form-actions full-width"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button><button type="button" className="secondary-button" onClick={() => onDone('/employee/vouchers')}>Cancel</button></div>
    </form>
  </>;
}

function SignaturePanel({ role }) {
  const [signature, setSignature] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const endpoint = role === 'director' ? '/vouchers/director-signature' : '/vouchers/signature';
  useEffect(() => { api('/vouchers/signature/me').then((data) => setSignature(data.signature)).catch((e) => setError(e.message)); }, [role]);
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = new FormData(); data.append('signature', file);
    setError(''); setMessage('Uploading signature…');
    try {
      const result = await api(endpoint, { method: 'POST', body: data });
      setSignature(result.signature); setMessage('Signature saved.');
    } catch (e) { setMessage(''); setError(e.message); }
    event.target.value = '';
  }
  return <div className="signature-panel">
    <div><strong>{role === 'director' ? 'Director signature' : 'Employee signature'}</strong>
      {signature ? <ProtectedImage filename={signature} alt={`${role} signature`} /> : <p className="muted small">No signature uploaded.</p>}
      {message && <p className="success-text">{message}</p>}{error && <p className="error small">{error}</p>}
    </div>
    <label className="upload-button">{signature ? 'Replace signature' : 'Upload signature'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /></label>
  </div>;
}

function ProtectedImage({ filename, alt }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let objectUrl;
    fetch(`/api/vouchers/signatures/${filename}`, { headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey)}` } }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load signature.');
      objectUrl = URL.createObjectURL(await response.blob()); setUrl(objectUrl);
    }).catch(() => setUrl(''));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [filename]);
  return url ? <img className="signature-image" src={url} alt={alt} /> : <span className="muted small">Loading signature…</span>;
}

function VoucherDetails({ id, user, navigate, setNotice }) {
  const [voucher, setVoucher] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { try { const data = await api(`/vouchers/${id}`); setVoucher(data.voucher); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, [id]);
  async function decide(decision) {
    if (decision === 'rejected' && !reason.trim()) { setError('Enter a rejection reason.'); return; }
    setBusy(true); setError('');
    try {
      await api(`/vouchers/${id}/decision`, { method: 'POST', body: { decision, rejection_reason: reason } });
      setNotice(`Voucher ${decision}.`); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function removeDraft() {
    if (!window.confirm('Delete this draft voucher?')) return;
    setBusy(true); setError('');
    try { await api(`/vouchers/${id}`, { method: 'DELETE' }); navigate('/employee/vouchers'); setNotice('Draft voucher deleted.'); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  async function submitDraft() {
    setBusy(true); setError('');
    try { await api(`/vouchers/${id}/submit`, { method: 'POST', body: {} }); setNotice('Voucher submitted for approval.'); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (error && !voucher) return <ErrorMessage message={error} />;
  if (!voucher) return <Loading />;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Voucher #{voucher.voucher_number}</p><h1>{voucher.expense_title || 'Voucher details'}</h1></div><button className="secondary-button print-button" onClick={() => window.print()}>Print</button></div>
    {error && <ErrorMessage message={error} />}
    <section className="section-card details-card">
      <div className="detail-grid">
        <Detail label="Status"><span className={`badge ${voucher.status}`}>{statusLabel(voucher.status)}</span></Detail>
        <Detail label="Amount">{money(voucher.amount)}</Detail><Detail label="Voucher date">{date(voucher.voucher_date)}</Detail><Detail label="Expense date">{date(voucher.expense_date)}</Detail>
        <Detail label="Department">{voucher.department || '—'}</Detail><Detail label="Category">{voucher.category}</Detail>
        <Detail label="Employee">{voucher.employee_name} · {voucher.employee_email}</Detail>
        <Detail label="Created">{date(voucher.created_at)}</Detail><Detail label="Submitted">{date(voucher.submitted_at)}</Detail>
        <Detail label="Description" wide>{voucher.description}</Detail>
        <Detail label="Employee signature"><SignatureOrNone filename={voucher.employee_signature_path} alt="Employee signature" /></Detail>
        {voucher.director_signature_path && <Detail label="Director signature"><SignatureOrNone filename={voucher.director_signature_path} alt="Director signature" /></Detail>}
        {voucher.decided_at && <Detail label="Decision date">{date(voucher.decided_at)}</Detail>}
        {voucher.director_name && <Detail label="Reviewed by">{voucher.director_name}</Detail>}
        {voucher.rejection_reason && <Detail label="Rejection reason" wide><span className="rejection-reason">{voucher.rejection_reason}</span></Detail>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {user.role === 'employee' && voucher.status === 'draft' && <div className="form-actions detail-actions"><button onClick={() => navigate(`/employee/vouchers/${id}/edit`)}>Edit draft</button><button onClick={submitDraft} disabled={busy}>Submit for approval</button><button className="danger-button" onClick={removeDraft} disabled={busy}>Delete draft</button></div>}
      {user.role === 'director' && voucher.status === 'pending_approval' && <div className="decision-box"><SignaturePanel role="director" /><label>Rejection reason<textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required when rejecting" /></label><div className="form-actions"><button onClick={() => decide('approved')} disabled={busy}>Approve voucher</button><button className="danger-button" onClick={() => decide('rejected')} disabled={busy}>Reject voucher</button></div></div>}
    </section>
  </>;
}

function SignatureOrNone({ filename, alt }) {
  return filename ? <ProtectedImage filename={filename} alt={alt} /> : <span className="muted">Not available</span>;
}

function Detail({ label, children, wide }) {
  return <div className={wide ? 'detail-item full-width' : 'detail-item'}><span>{label}</span><div>{children}</div></div>;
}

function Loading() { return <p className="loading">Loading…</p>; }
function ErrorMessage({ message }) { return <p className="error message" role="alert">{message}</p>; }
function money(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0)); }
function date(value) { return value ? new Date(value).toLocaleDateString('en-IN') : '—'; }
function statusLabel(status) { return ({ pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected', draft: 'Draft' })[status] || status; }

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

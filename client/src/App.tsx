import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, ApiError, errorMessage, initials, localDate, money, notifySessionExpired, SESSION_EXPIRED_EVENT } from './api';
import type { Account, Dashboard, Transaction, TransactionPage, User } from './api';
import { clearPendingPayment, isDefinitivePaymentFailure, readPendingPayment, savePendingPayment } from './pendingPayment.mjs';
import type { PendingPayment } from './pendingPayment.mjs';
import Icon, { Logo } from './Icons';
import type { IconName } from './Icons';

type View = 'Overview' | 'Accounts' | 'Transactions' | 'Settings';
type ModalKind = 'transfer' | 'fund' | 'account' | null;
const navigation: { label: View; icon: IconName }[] = [{ label: 'Overview', icon: 'overview' }, { label: 'Accounts', icon: 'accounts' }, { label: 'Transactions', icon: 'activity' }, { label: 'Settings', icon: 'settings' }];

function ErrorNotice({ children }: { children: ReactNode }) { return <div className="error-notice" role="alert">{children}</div>; }
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><span className="empty-icon"><Icon name="activity" size={26} /></span><h3>{title}</h3><p>{children}</p></div>; }
function Loading({ label = 'Loading your finances…' }: { label?: string }) { return <div className="loading" role="status"><span className="spinner" />{label}</div>; }

export default function App() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [serverError, setServerError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [allowDemo, setAllowDemo] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [dataError, setDataError] = useState('');
  const [view, setView] = useState<View>('Overview');
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [toast, setToast] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [pendingError, setPendingError] = useState('');

  const connect = useCallback(async () => {
    setStatus('loading');
    try {
      const health = await api<{ sandbox: boolean; demo: boolean }>('/health');
      setSandbox(health.sandbox);
      setAllowDemo(health.demo === true);
      try { const result = await api<{ user: User }>('/auth/me'); setUser(result.user); }
      catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; setUser(null); }
      setStatus('ready');
    } catch (error) { setServerError(errorMessage(error)); setStatus('offline'); }
  }, []);
  const clearLocalSession = useCallback(() => {
    setUser(null); setView('Overview'); setData(null); setDataError(''); setModal(null);
    setSelectedAccountId(''); setMobileNav(false); setPendingPayment(null); setPendingError('');
  }, []);
  useEffect(() => {
    const expired = () => { clearLocalSession(); setToast('Your session ended. Please sign in again.'); };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [clearLocalSession]);
  useEffect(() => { void connect(); }, [connect]);
  useEffect(() => {
    setPendingPayment(null); setPendingError('');
    if (!user) return;
    try {
      const saved = readPendingPayment(window.sessionStorage, user.id);
      setPendingPayment(saved);
      if (saved) setModal(saved.kind);
    } catch (error) { setPendingError(errorMessage(error)); }
  }, [user?.id]);
  useEffect(() => {
    if (!user) { setData(null); return; }
    let active = true;
    setDataError('');
    api<Dashboard>('/dashboard').then(result => { if (active) { setData(result); setSandbox(result.sandbox); } }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) { setUser(null); setToast('Your session ended. Please sign in again.'); }
      else setDataError(errorMessage(error));
    });
    return () => { active = false; };
  }, [user, refresh]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 6000); return () => window.clearTimeout(timer); }, [toast]);

  async function logout() {
    setLoggingOut(true);
    try { await api('/auth/logout', { method: 'POST' }); clearLocalSession(); }
    catch (error) { if (error instanceof ApiError && error.status === 401) clearLocalSession(); else setToast(errorMessage(error)); }
    finally { setLoggingOut(false); }
  }
  function completed(message: string) { setModal(null); setToast(message); setRefresh(value => value + 1); }
  function openPayment(kind: 'transfer' | 'fund', accountId = '') {
    if (!user) return;
    try {
      const saved = readPendingPayment(window.sessionStorage, user.id);
      setPendingPayment(saved); setPendingError('');
      setSelectedAccountId(saved?.fromAccountId || accountId); setModal(saved?.kind || kind);
    } catch (error) { setPendingError(errorMessage(error)); }
  }
  const notify = useCallback((message: string) => setToast(message), []);

  if (status === 'loading') return <div className="startup"><Logo /><Loading label="Connecting to Vault…" /></div>;
  if (status === 'offline') return <div className="startup"><Logo /><div className="connection-card"><span className="empty-icon"><Icon name="accounts" size={30} /></span><h1>Let’s get you connected.</h1><p>Vault needs its banking server and database to load your accounts.</p><ErrorNotice>{serverError}</ErrorNotice><p className="small">For a local demo, run <code>npm run demo</code> from the project folder. For your own database, finish the connection steps in the project README.</p><button className="button primary" onClick={() => void connect()}><Icon name="refresh" />Try again</button></div></div>;
  if (!user) return <><Auth allowDemo={allowDemo} onLogin={nextUser => { setUser(nextUser); setView('Overview'); }} />{toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={17} /></button></div>}</>;

  return <div className="app-shell">
    {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><Logo /><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNav(false)}><Icon name="close" /></button></div>
      <div className="workspace-label">PERSONAL BANKING</div>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.label} className={`nav-item ${view === item.label ? 'active' : ''}`} aria-current={view === item.label ? 'page' : undefined} onClick={() => { setView(item.label); setMobileNav(false); }}><Icon name={item.icon} /><span>{item.label}</span>{view === item.label && <span className="nav-active-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="sidebar-note-icon"><Icon name="shield" /></span><strong>A little more clarity.</strong><p>Your accounts, activity and next move. All in one place.</p><span className="sidebar-note-line" /></div><button className="profile-switch" onClick={() => { setView('Settings'); setMobileNav(false); }}><span className="avatar">{initials(user.name)}</span><span className="profile-copy"><strong>{user.name}</strong><small>Personal account</small></span><Icon name="chevron" size={16} /></button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-only" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><Icon name="menu" /></button><span>My workspace</span><span className="breadcrumb-divider">/</span><strong>{view}</strong></div><div className="topbar-right"><span className="environment-badge"><span />{sandbox ? 'Sandbox · test funds' : 'Portfolio banking'}</span><button type="button" className="topbar-avatar" aria-label="Open profile details" onClick={() => { setView('Settings'); setMobileNav(false); }}>{initials(user.name)}</button></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">YOUR MONEY, IN PERSPECTIVE</div><h1>{view === 'Overview' ? `Welcome back, ${user.name.split(' ')[0]}.` : view === 'Accounts' ? 'A place for every plan.' : view === 'Transactions' ? 'Every move, accounted for.' : 'Make yourself at home.'}</h1><p>{view === 'Overview' ? 'Here’s where things stand with your money today.' : view === 'Accounts' ? 'Keep your everyday spending and bigger goals in view.' : view === 'Transactions' ? 'Find the details. Follow the flow.' : 'Your profile and account access, at a glance.'}</p></div>{view !== 'Settings' && <div className="page-actions">{sandbox && <button className="button secondary" disabled={!data} onClick={() => openPayment('fund')}><Icon name="plus" size={17} />Add money</button>}<button className="button primary" disabled={!data?.accounts.length} onClick={() => openPayment('transfer')}><Icon name="up" size={17} />Transfer money</button></div>}</div>
        {pendingError && <div className="data-error"><ErrorNotice>{pendingError}</ErrorNotice></div>}
        {pendingPayment?.userId === user.id && <div className="info-banner"><Icon name="shield" size={22} /><div><strong>A payment is awaiting confirmation.</strong><p>Resume the saved payment before starting another transfer or deposit.</p><button className="text-button" onClick={() => openPayment(pendingPayment.kind)}>Resume payment</button></div></div>}
        {dataError && <div className="data-error"><ErrorNotice>{dataError} <button className="text-button" onClick={() => setRefresh(value => value + 1)}>Try again</button></ErrorNotice></div>}
        {!data && !dataError && <Loading />}
        {data && view === 'Overview' && <Overview data={data} showTransactions={() => setView('Transactions')} showAccounts={() => setView('Accounts')} transfer={() => openPayment('transfer')} />}
        {data && view === 'Accounts' && <Accounts accounts={data.accounts} sandbox={sandbox} create={() => setModal('account')} fund={accountId => openPayment('fund', accountId)} notify={notify} />}
        {data && view === 'Transactions' && <Transactions accounts={data.accounts} refresh={refresh} notify={notify} />}
        {view === 'Settings' && <Settings user={user} accounts={data?.accounts || []} sandbox={sandbox} updateUser={setUser} logout={() => void logout()} loggingOut={loggingOut} />}
        <footer className="page-footer"><span><span className="footer-mark">v.</span> A thoughtful home for your money.</span><span>{sandbox ? 'Demo environment · No real money' : 'Portfolio project · No external payments'}</span></footer>
      </div>
    </main>
    {modal && data && <BankingModal key={`${user.id}:${modal}`} userId={user.id} kind={modal} pending={modal === 'account' ? null : pendingPayment} pendingChanged={setPendingPayment} accounts={data.accounts} selectedAccountId={selectedAccountId} sandbox={sandbox} close={() => { setModal(null); setSelectedAccountId(''); }} completed={message => { setSelectedAccountId(''); completed(message); }} />}
    {toast && <div className="toast" role="status"><Icon name="check" size={18} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={17} /></button></div>}
  </div>;
}

function Auth({ onLogin, allowDemo }: { onLogin: (user: User) => void; allowDemo: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent, demo = false) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await api<{ user: User }>(`/auth/${demo ? 'login' : mode}`, { method: 'POST', body: JSON.stringify(demo ? { email: 'brijesh@vault.demo', password: 'VaultDemo123!' } : { ...(mode === 'register' ? { name: name.trim() } : {}), email: email.trim(), password }) });
      onLogin(result.user);
    } catch (err) { setError(`${errorMessage(err)}${demo ? ' Demo accounts are created by npm run demo.' : ''}`); }
    finally { setBusy(false); submitting.current = false; }
  }
  return <main className="auth-layout"><section className="auth-story"><Logo /><div className="auth-story-copy"><span className="story-kicker">A CLEARER KIND OF BANKING</span><h1>A little clarity.<br />A lot of possibility.</h1><p>A home for your everyday money<br className="desktop-only" /> and everything you’re working toward.</p><div className="auth-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="art-card"><span>vault.</span><span className="art-chip" /><div className="art-card-bottom"><span>YOUR NEXT CHAPTER</span><span>↗</span></div></div><span className="art-dot" /></div></div><div className="auth-story-footer"><Icon name="shield" size={17} />Built for a little more peace of mind.</div></section><section className="auth-form-panel"><div className="auth-topline"><span>{mode === 'login' ? 'New around here?' : 'Already have an account?'}</span><button className="text-button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}<Icon name="arrow" size={16} /></button></div><div className="auth-form-wrap"><span className="auth-mobile-logo"><Logo /></span><div className="eyebrow">WELCOME TO VAULT</div><h2>{mode === 'login' ? 'Good to have you back.' : 'Your next chapter starts here.'}</h2><p>{mode === 'login' ? 'Sign in and settle into your financial picture.' : 'Create your profile. Your first savings account is on us.'}</p><form onSubmit={event => void submit(event)}>{mode === 'register' && <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Your full name" required minLength={2} maxLength={80} disabled={busy} /></label>}<label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} disabled={busy} /></label><label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'Choose a strong password'} required minLength={mode === 'register' ? 10 : 1} maxLength={72} disabled={busy} /></label>{mode === 'register' && <p className="field-help">Use at least 10 characters, with uppercase, lowercase and a number.</p>}{error && <ErrorNotice>{error}</ErrorNotice>}<button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in to Vault' : 'Create my account'}<Icon name="arrow" size={18} /></button></form>{allowDemo && mode === 'login' && <><div className="form-divider"><span>JUST EXPLORING?</span></div><button className="button demo-button" disabled={busy} onClick={event => void submit(event, true)}>Take a look with the demo account<Icon name="up" size={17} /></button><p className="demo-hint">A sandbox with test funds. No real money involved.</p></>}<p className="auth-legal">A personal banking portfolio project.<br />Real curiosity. Test money.</p></div><div className="auth-bottomline"><span>© {new Date().getFullYear()} Vault</span><span>Made for the bigger picture.</span></div></section></main>;
}

function Overview({ data, showTransactions, showAccounts, transfer }: { data: Dashboard; showTransactions: () => void; showAccounts: () => void; transfer: () => void }) {
  return <><section className="stats-grid" aria-label="Account summary"><article className="balance-card"><div className="stat-top"><span>Total balance</span><span className="stat-icon"><Icon name="accounts" /></span></div><div className="main-balance">{money(data.summary.totalBalancePaise)}</div><div className="balance-bottom"><span><span className="status-dot" />Across {data.accounts.length} {data.accounts.length === 1 ? 'account' : 'accounts'}</span><span>INR</span></div><div className="balance-decoration" /></article><article className="stat-card"><div className="stat-top"><span>Money in</span><span className="stat-icon income"><Icon name="down" /></span></div><strong>{money(data.summary.incomePaise)}</strong><div className="stat-bottom"><span className="mini-dot green" />Past 7 days, including today</div></article><article className="stat-card"><div className="stat-top"><span>Money out</span><span className="stat-icon expense"><Icon name="up" /></span></div><strong>{money(data.summary.expensePaise)}</strong><div className="stat-bottom"><span className="mini-dot amber" />Past 7 days, including today</div></article></section>
    <div className="overview-middle"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Money in motion</h2><p>Your cash flow over the past 7 days · UTC</p></div><span className="period-badge">This week<Icon name="activity" size={14} /></span></div><ActivityChart activity={data.activity} /></section><section className="panel accounts-preview"><div className="panel-heading"><h2>Your accounts</h2><button className="text-button muted" onClick={showAccounts} aria-label="View all accounts"><Icon name="up" size={18} /></button></div><div className="preview-account-list">{data.accounts.slice(0, 3).map((account, index) => <button className="preview-account" key={account.id} onClick={showAccounts}><span className={`account-symbol tone-${index % 3}`}><Icon name="accounts" size={20} /></span><span><strong>{account.name}</strong><small>•••• {account.accountNumber.slice(-4)}</small></span><b>{money(account.balancePaise)}</b></button>)}</div><div className="account-preview-footer"><span>Good plans start with a clear view.</span><button className="text-button" onClick={showAccounts}>Manage accounts<Icon name="arrow" size={16} /></button></div></section></div>
    <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>The latest chapter in your money story.</p></div><button className="text-button" onClick={showTransactions}>View all transactions<Icon name="arrow" size={16} /></button></div>{data.recentTransactions.length ? <TransactionTable transactions={data.recentTransactions} /> : <Empty title="A fresh start.">Your transactions will appear here. {data.sandbox ? 'Add some test money to get started.' : 'Your account is ready to receive transfers.'}</Empty>}</section><div className="overview-note"><span><Icon name="shield" size={17} />Your financial picture, all in one place.</span><button className="text-button muted" onClick={transfer}>Make your next move<Icon name="arrow" size={16} /></button></div></>;
}

function ActivityChart({ activity }: { activity: Dashboard['activity'] }) {
  const width = 600; const height = 175; const left = 48; const right = 15; const top = 12; const bottom = 24;
  const maximum = Math.max(10000, ...activity.flatMap(day => [day.incomePaise, day.expensePaise]));
  const chartHeight = height - top - bottom;
  const point = (index: number, amount: number) => `${left + index * (width - left - right) / Math.max(1, activity.length - 1)},${top + (1 - amount / maximum) * chartHeight}`;
  const line = (key: 'incomePaise' | 'expensePaise') => activity.map((day, index) => `${index === 0 ? 'M' : 'L'}${point(index, day[key])}`).join(' ');
  const hasActivity = activity.some(day => day.incomePaise || day.expensePaise);
  return <div className="chart"><div className="chart-legend"><span><i className="legend-dot in" />Money in</span><span><i className="legend-dot out" />Money out</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={hasActivity ? 'Daily incoming and outgoing amounts over the past seven days. Exact figures are listed below the chart.' : 'No money movement over the past seven days.'}><defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2c8e70" stopOpacity=".18" /><stop offset="100%" stopColor="#2c8e70" stopOpacity=".01" /></linearGradient></defs>{[0, .5, 1].map(ratio => <g key={ratio}><line x1={left} x2={width - right} y1={top + ratio * chartHeight} y2={top + ratio * chartHeight} stroke="#e9ece8" strokeDasharray="4 5" /><text x={left - 9} y={top + ratio * chartHeight + 4} textAnchor="end" fill="#8b938f" fontSize="10">{new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(maximum * (1 - ratio) / 100)}</text></g>)}{activity.length > 0 && <><path d={`${line('incomePaise')} L${width - right},${height - bottom} L${left},${height - bottom} Z`} fill="url(#incomeFill)" /><path d={line('incomePaise')} fill="none" stroke="#278368" strokeWidth="2.5" strokeLinejoin="round" /><path d={line('expensePaise')} fill="none" stroke="#d0a576" strokeWidth="2" strokeLinejoin="round" />{activity.map((day, index) => <g key={day.date}><text x={left + index * (width - left - right) / Math.max(1, activity.length - 1)} y={height - 3} textAnchor="middle" fill="#8b938f" fontSize="10">{day.label}</text><circle cx={left + index * (width - left - right) / Math.max(1, activity.length - 1)} cy={top + (1 - day.incomePaise / maximum) * chartHeight} r="3" fill="#278368"><title>{day.date}: incoming {money(day.incomePaise)}, outgoing {money(day.expensePaise)}</title></circle></g>)}</>}</svg><span className="chart-unit">Amounts in INR</span><table className="sr-only"><caption>Daily cash flow, UTC</caption><thead><tr><th>Date</th><th>Money in</th><th>Money out</th></tr></thead><tbody>{activity.map(day => <tr key={day.date}><th>{day.date}</th><td>{money(day.incomePaise)}</td><td>{money(day.expensePaise)}</td></tr>)}</tbody></table></div>;
}

function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  return <div className="table-scroll"><table className="transaction-table"><thead><tr><th>TRANSACTION</th><th>DATE</th><th>STATUS</th><th className="amount-heading">AMOUNT</th></tr></thead><tbody>{transactions.map(transaction => <tr key={`${transaction.id}-${transaction.accountId}-${transaction.direction}`}><td><div className="transaction-cell"><span className={`transaction-icon ${transaction.direction}`}><Icon name={transaction.direction === 'credit' ? 'down' : 'up'} size={18} /></span><span><strong>{transaction.description || (transaction.direction === 'credit' ? 'Money received' : 'Money sent')}</strong><small>{transaction.type === 'deposit' ? 'Sandbox funding' : transaction.direction === 'credit' ? `From ${transaction.from?.name || 'Account'}` : `To ${transaction.to.name}`}<span className="reference"> · {transaction.reference}</span></small></span></div></td><td><span className="transaction-date">{localDate(transaction.createdAt)}</span></td><td><span className="completed-badge"><span />Completed</span></td><td className={`transaction-amount ${transaction.direction}`}>{transaction.direction === 'credit' ? '+' : '−'}{money(transaction.amountPaise)}</td></tr>)}</tbody></table></div>;
}

function Accounts({ accounts, sandbox, create, fund, notify }: { accounts: Account[]; sandbox: boolean; create: () => void; fund: (accountId: string) => void; notify: (message: string) => void }) {
  async function copy(number: string) { try { await navigator.clipboard.writeText(number); notify('Account number copied.'); } catch { notify('Copy is unavailable. Select the account number to copy it.'); } }
  return <><div className="section-line"><h2>Your savings accounts <span className="count-badge">{accounts.length} / 5</span></h2><button className="button secondary" onClick={create} disabled={accounts.length >= 5}><Icon name="plus" size={17} />New account</button></div><div className="account-grid">{accounts.map((account, index) => <article className={`account-card account-card-${index % 3}`} key={account.id}><div className="account-card-top"><span className="account-symbol"><Icon name="accounts" /></span><span className="savings-label">SAVINGS · INR</span><span className="account-active"><span />Active</span></div><h2>{account.name}</h2><p className="account-number"><span>{account.accountNumber}</span><button aria-label={`Copy account number for ${account.name}`} onClick={() => void copy(account.accountNumber)}><Icon name="copy" size={15} /></button></p><div className="account-card-balance"><span>Available balance</span><strong>{money(account.balancePaise)}</strong></div><div className="account-card-bottom"><span>Opened {localDate(account.createdAt)}</span>{sandbox && <button className="text-button" onClick={() => fund(account.id)}>Add money<Icon name="plus" size={15} /></button>}</div></article>)}</div><div className="info-banner"><Icon name="shield" size={22} /><div><strong>Room for your different goals.</strong><p>Create up to five savings accounts. Share your account number to receive a transfer from another Vault user.{sandbox ? ' All balances here are test funds.' : ''}</p></div></div></>;
}

function Transactions({ accounts, refresh, notify }: { accounts: Account[]; refresh: number; notify: (message: string) => void }) {
  const [search, setSearch] = useState(''); const [accountId, setAccountId] = useState(''); const [direction, setDirection] = useState('all'); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const [result, setResult] = useState<TransactionPage | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false); const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ ...(search ? { search } : {}), ...(accountId ? { accountId } : {}), direction, ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page), limit: '10' }).toString();
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    if (from && to && from > to) { setError('Choose an end date on or after the start date.'); setLoading(false); return; }
    const timer = window.setTimeout(() => { api<TransactionPage>(`/transactions?${query}`).then(next => { if (active) setResult(next); }).catch(err => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setLoading(false); }); }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, refresh, from, to, retry]);
  async function download() {
    setExporting(true);
    try {
      const response = await fetch(`/api/transactions/export?${query}`, { credentials: 'include' });
      if (response.status === 401) notifySessionExpired();
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'The export could not be created.'); }
      if (!(response.headers.get('content-type') || '').includes('text/csv')) throw new Error('The server did not return a CSV export. Please try again.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `vault-transactions-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Your transaction export is ready.');
    } catch (err) { notify(errorMessage(err)); } finally { setExporting(false); }
  }
  const activeFilters = search || accountId || direction !== 'all' || from || to;
  return <section className="panel transactions-panel"><div className="panel-heading"><div><h2>Your transaction history</h2><p>Transfers and deposits across your accounts.</p></div><button className="button secondary compact" disabled={exporting || !!error || loading || !result?.pagination.total} onClick={() => void download()}><Icon name="download" size={17} />{exporting ? 'Exporting…' : 'Export CSV'}</button></div><div className="filter-bar"><label className="search-field"><span className="sr-only">Search transactions</span><Icon name="search" size={18} /><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search transactions…" maxLength={100} /></label><label className="filter-select"><span className="sr-only">Account</span><select value={accountId} onChange={event => { setAccountId(event.target.value); setPage(1); }}><option value="">All accounts</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.accountNumber.slice(-4)}</option>)}</select></label><label className="filter-select"><span className="sr-only">Direction</span><select value={direction} onChange={event => { setDirection(event.target.value); setPage(1); }}><option value="all">All activity</option><option value="credit">Money in</option><option value="debit">Money out</option></select></label></div><div className="date-filter-row"><label>From<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label>To<input type="date" value={to} min={from} onChange={event => { setTo(event.target.value); setPage(1); }} /></label><span className="date-help">Dates use UTC</span>{activeFilters && <button className="text-button" onClick={() => { setSearch(''); setAccountId(''); setDirection('all'); setFrom(''); setTo(''); setPage(1); }}>Clear filters</button>}</div>{loading ? <Loading label="Finding your transactions…" /> : error ? <div className="table-error"><ErrorNotice>{error}</ErrorNotice><button className="text-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : result?.transactions.length ? <TransactionTable transactions={result.transactions} /> : <Empty title={activeFilters ? 'No matches this time.' : 'Your story starts here.'}>{activeFilters ? 'Try a different search or clear your filters.' : 'Your transfers and deposits will appear here.'}</Empty>}{result && !loading && !error && <div className="pagination"><span>{result.pagination.total === 0 ? '0 transactions' : `${(page - 1) * 10 + 1}–${Math.min(page * 10, result.pagination.total)} of ${result.pagination.total} transactions`}</span><div><button className="button secondary compact" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page} / {Math.max(1, result.pagination.pages)}</span><button className="button secondary compact" disabled={page >= result.pagination.pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}</section>;
}

function Settings({ user, accounts, sandbox, updateUser, logout, loggingOut }: { user: User; accounts: Account[]; sandbox: boolean; updateUser: (user: User) => void; logout: () => void; loggingOut: boolean }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      updateUser(result.user); setName(result.user.name); setMessage('Your name has been updated.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h2>Your profile</h2><p>The person behind the plans.</p></div></div><div className="settings-profile"><span className="avatar large">{initials(user.name)}</span><div><h3>{user.name}</h3><span>Personal account</span></div></div><form onSubmit={event => void save(event)}><label>Full name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={busy} /></label>{error && <ErrorNotice>{error}</ErrorNotice>}{message && <p className="field-help" role="status">{message}</p>}<button className="button primary" type="submit" disabled={busy || name.trim() === user.name}>{busy ? 'Saving…' : 'Save changes'}</button></form><dl className="detail-list"><div><dt>Full name</dt><dd>{user.name}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div><div><dt>Date of birth</dt><dd>{user.dob ? localDate(user.dob) : 'Not added yet'}</dd></div><div><dt>Account number</dt><dd>{accounts[0]?.accountNumber || 'No account available'}</dd></div><div><dt>Member since</dt><dd>{localDate(user.createdAt)}</dd></div></dl></section><section className="panel settings-panel"><div className="panel-heading"><div><h2>Account access</h2><p>You’re in control of this session.</p></div></div><div className="session-block"><span className="account-symbol"><Icon name="shield" /></span><div><h3>Signed in on this browser</h3><p>Your session is active. Sign out when you’re finished on a shared device.</p></div></div><button className="button secondary signout-button" onClick={logout} disabled={loggingOut}><Icon name="logout" size={17} />{loggingOut ? 'Signing out…' : 'Sign out'}</button><div className="settings-environment"><strong>{sandbox ? 'Sandbox environment' : 'Portfolio environment'}</strong><p>{sandbox ? 'Funds are for testing. You can add test money, send transfers and explore every feature.' : 'Transfers stay within this application. No external bank or payment provider is connected.'}</p></div></section></div>;
}

function Modal({ title, subtitle, children, close, busy }: { title: string; subtitle: string; children: ReactNode; close: () => void; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('input, select, button')?.focus(), 0);
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.clearTimeout(timer); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) close();
    if (event.key === 'Tab') { const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'); if (!elements?.length) return; const first = elements[0]; const last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  }}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description"><div className="modal-heading"><span className="modal-symbol"><Icon name="activity" size={23} /></span><button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}><Icon name="close" /></button></div><h2 id="modal-title">{title}</h2><p id="modal-description">{subtitle}</p>{children}</div></div>;
}

function BankingModal({ userId, kind, pending, pendingChanged, accounts, selectedAccountId, sandbox, close, completed }: { userId: string; kind: Exclude<ModalKind, null>; pending: PendingPayment | null; pendingChanged: (payment: PendingPayment | null) => void; accounts: Account[]; selectedAccountId: string; sandbox: boolean; close: () => void; completed: (message: string) => void }) {
  const [fromAccountId, setFromAccountId] = useState(pending?.fromAccountId || selectedAccountId || accounts[0]?.id || '');
  const [toNumber, setToNumber] = useState(pending?.toAccountNumber || '');
  const [amount, setAmount] = useState(pending?.amount || '');
  const [description, setDescription] = useState(pending?.description || '');
  const [name, setName] = useState('');
  const [recipient, setRecipient] = useState<{ accountNumber: string; name: string } | null>(pending?.kind === 'transfer' ? { accountNumber: pending.toAccountNumber, name: pending.recipientName } : null);
  const [lookingUp, setLookingUp] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [review, setReview] = useState(Boolean(pending)); const [uncertain, setUncertain] = useState(Boolean(pending));
  const submitting = useRef(false);
  const lookupVersion = useRef(0);
  const source = accounts.find(account => account.id === fromAccountId);
  const amountPaise = Math.round(Number(amount) * 100);
  function changed() { setReview(false); setError(''); setUncertain(false); }
  async function lookup() {
    if (!/^\d{12}$/.test(toNumber.trim())) { setError('Enter the recipient’s 12-digit account number.'); return; }
    const version = ++lookupVersion.current; setLookingUp(true); setError('');
    try { const result = await api<{ recipient: { accountNumber: string; name: string } }>(`/recipients/lookup?accountNumber=${encodeURIComponent(toNumber.trim())}`); if (version === lookupVersion.current) setRecipient(result.recipient); }
    catch (err) { if (version === lookupVersion.current) { setError(errorMessage(err)); setRecipient(null); } }
    finally { if (version === lookupVersion.current) setLookingUp(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return; setError('');
    if (kind !== 'account' && !pending) {
      if (!source) { setError('Choose an account.'); return; }
      if (!/^(?:0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 10_000_000_000) { setError('Enter an amount from ₹0.01 to ₹10,00,00,000, with no more than two decimal places.'); return; }
      if (kind === 'transfer') {
        if (!recipient || recipient.accountNumber !== toNumber.trim()) { setError('Check the recipient’s account before continuing.'); return; }
        if (recipient.accountNumber === source.accountNumber) { setError('Choose a different account to receive this transfer.'); return; }
        if (amountPaise > source.balancePaise && !uncertain) { setError('There isn’t enough money in this account for that transfer.'); return; }
      }
      if (kind === 'fund' && !sandbox) { setError('Test funding is not enabled for this environment.'); return; }
      if (!review) { setReview(true); return; }
    }
    submitting.current = true; setBusy(true);
    let payment: PendingPayment | null = null;
    let wasAlreadyPending = false;
    let sent = false;
    try {
      if (kind === 'account') {
        await api('/accounts', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
        completed('Your new savings account is ready.');
        return;
      }
      const saved = readPendingPayment(window.sessionStorage, userId);
      wasAlreadyPending = Boolean(saved);
      if (saved && saved.key !== pending?.key) throw new Error('A saved payment is awaiting confirmation. Close this dialog and choose Resume payment.');
      payment = savePendingPayment(window.sessionStorage, saved || {
        version: 1, userId, kind, key: crypto.randomUUID(), fromAccountId,
        toAccountNumber: kind === 'transfer' ? recipient!.accountNumber : '',
        recipientName: kind === 'transfer' ? recipient!.name : '', amount,
        description: kind === 'transfer' ? description.trim() : '', createdAt: new Date().toISOString(),
      });
      pendingChanged(payment);
      const payload = payment.kind === 'fund' ? { amount: payment.amount } : {
        fromAccountId: payment.fromAccountId, toAccountNumber: payment.toAccountNumber,
        amount: payment.amount, description: payment.description,
      };
      sent = true;
      await api(payment.kind === 'fund' ? `/accounts/${payment.fromAccountId}/fund` : '/transfers', { method: 'POST', headers: { 'Idempotency-Key': payment.key }, body: JSON.stringify(payload) });
      clearPendingPayment(window.sessionStorage, userId, payment.key);
      pendingChanged(null);
      completed(kind === 'fund' ? `${money(amountPaise)} in test funds added.` : `${money(amountPaise)} sent to ${recipient!.name}.`);
    } catch (err) {
      setError(errorMessage(err));
      if (payment && sent && err instanceof ApiError && isDefinitivePaymentFailure(err.status, err.code, wasAlreadyPending)) {
        try { clearPendingPayment(window.sessionStorage, userId, payment.key); pendingChanged(null); setUncertain(false); }
        catch (storageError) { setError(errorMessage(storageError)); setUncertain(true); }
      } else setUncertain(kind !== 'account' && (Boolean(pending) || Boolean(payment && sent)));
    }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={kind === 'account' ? 'Give your goal a home.' : review ? 'Everything look right?' : kind === 'fund' ? 'A little room to explore.' : 'Make your next move.'} subtitle={kind === 'account' ? 'Open a savings account with a name that means something to you.' : review ? 'Take a moment to check the details below.' : kind === 'fund' ? 'Add test money to your sandbox account.' : 'Send money to another Vault account.'} close={close} busy={busy}>
    <form onSubmit={event => void submit(event)}>
      {kind === 'account' ? <><label>Account name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Everyday savings" minLength={2} maxLength={50} required disabled={busy} autoFocus /></label><div className="form-note">Savings · INR · Starts with a zero balance</div></> : review ? <div className="review"><div className="review-amount"><span>{kind === 'fund' ? 'ADDING TEST FUNDS' : 'YOU’RE SENDING'}</span><strong>{money(amountPaise)}</strong></div><dl><div><dt>{kind === 'fund' ? 'To account' : 'From'}</dt><dd>{source?.name}<small>•••• {source?.accountNumber.slice(-4)}</small></dd></div>{kind === 'transfer' && <><div><dt>To</dt><dd>{recipient?.name}<small>{recipient?.accountNumber}</small></dd></div><div><dt>Note</dt><dd>{description.trim() || 'No note added'}</dd></div></>}<div><dt>Environment</dt><dd>{sandbox ? 'Sandbox · test funds' : 'Internal Vault transfer'}</dd></div></dl></div> : <><label>{kind === 'fund' ? 'Add to account' : 'From account'}<select value={fromAccountId} onChange={event => { setFromAccountId(event.target.value); changed(); }} required disabled={busy}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.accountNumber.slice(-4)}</option>)}</select></label>{source && <p className="field-help">Available balance: <strong>{money(source.balancePaise)}</strong></p>}{kind === 'transfer' && <><label>Recipient account number<div className="recipient-input"><input inputMode="numeric" value={toNumber} onChange={event => { setToNumber(event.target.value); setRecipient(null); lookupVersion.current++; setLookingUp(false); changed(); }} placeholder="Enter a Vault account number" maxLength={12} required disabled={busy} /><button type="button" className="button secondary compact" onClick={() => void lookup()} disabled={busy || lookingUp || !toNumber.trim()}>{lookingUp ? 'Checking…' : 'Check'}</button></div></label>{recipient && <div className="recipient-match"><Icon name="check" size={16} />{recipient.name}<span>Account found</span></div>}</>}<label>Amount (INR)<div className="amount-input"><span>₹</span><input value={amount} onChange={event => { setAmount(event.target.value); changed(); }} inputMode="decimal" placeholder="0.00" required maxLength={14} disabled={busy} /></div></label>{kind === 'transfer' && <label>Note <span className="optional">optional</span><input value={description} onChange={event => { setDescription(event.target.value); changed(); }} placeholder="What’s this for?" maxLength={140} disabled={busy} /></label>}{kind === 'fund' && <div className="form-note"><Icon name="shield" size={17} />For exploring only. These are not real funds.</div>}</>}
      {error && <ErrorNotice>{error}</ErrorNotice>}{uncertain && <p className="retry-note" role="status">The result could not be confirmed. Use “Try again” to safely check or complete this saved payment. Its details will remain available if you close this dialog or reload this tab.</p>}
      <div className="modal-actions">{review && !uncertain && !pending && <button type="button" className="button secondary" disabled={busy} onClick={() => { setReview(false); setError(''); }}>Edit details</button>}<button className="button primary" type="submit" disabled={busy || lookingUp || (kind === 'transfer' && !recipient)}>{busy ? 'One moment…' : uncertain ? 'Try again' : kind === 'account' ? 'Create account' : review ? kind === 'fund' ? 'Add test money' : 'Confirm transfer' : 'Review details'}{!busy && <Icon name={review || kind === 'account' ? 'check' : 'arrow'} size={17} />}</button></div>
    </form>
  </Modal>;
}

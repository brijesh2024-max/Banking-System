export type IconName = 'overview' | 'accounts' | 'activity' | 'settings' | 'arrow' | 'plus' | 'down' | 'up' | 'logout' | 'search' | 'download' | 'close' | 'check' | 'shield' | 'menu' | 'chevron' | 'copy' | 'refresh';
const paths: Record<IconName, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  accounts: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M3 10h18M6 15h4" /></>,
  activity: <><path d="M4 6h15m-4-4 4 4-4 4M20 18H5m4-4-4 4 4 4" /></>,
  settings: <><path d="m9.3 3-.6 2.2-2 .9-2-.6-2.3 4 1.6 1.6v2.1L2.4 15l2.3 4 2.1-.6 1.9 1 .6 2.1h5.4l.6-2.2 2-.9 2 .6 2.3-4-1.6-1.7v-2l1.6-1.7-2.3-4-2.1.6-1.9-.9-.6-2.3Z" /><circle cx="12" cy="12" r="3.2" /></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>, plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="M17 7 7 17M7 7v10h10" />, up: <path d="m7 17 10-10M7 7h10v10" />,
  logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M9 12h12m-4-4 4 4-4 4" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>, close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />, shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />, chevron: <path d="m9 5 7 7-7 7" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V4H4v11h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
};
export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
export function Logo() { return <span className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><path d="m5 7 9 16L23 7M10 7l4 7 4-7" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>vault<span className="brand-dot">.</span></span>; }

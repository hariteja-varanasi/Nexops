import { useEffect, useState } from 'react';

/* ---------------------------------------------------------------- state */
export const tone = (value) => {
  const v = String(value || '').toUpperCase();
  if (['SUCCESS', 'RUNNING', 'HEALTHY', 'UP', 'ACTIVE', 'RESOLVED', 'SYNCED'].includes(v)) return 'ok';
  if (['DEPLOYING', 'PENDING', 'INVESTIGATING', 'PROGRESSING'].includes(v)) return 'run';
  if (['DEGRADED', 'ROLLED_BACK', 'PAUSED', 'WARN', 'OUTOFSYNC'].includes(v)) return 'warn';
  if (['FAILED', 'UNHEALTHY', 'DOWN', 'OPEN', 'STOPPED', 'ERROR'].includes(v)) return 'fail';
  return 'idle';
};

export const Pill = ({ value, label }) => (
  <span className={`pill ${tone(value)}`}>{(label ?? value ?? '—').toString().replace(/_/g, ' ')}</span>
);

export const Dot = ({ value }) => <span className={`dot ${tone(value)}`} />;

/* ---------------------------------------------------------------- shell */
export const Panel = ({ title, note, actions, children, bodyless }) => (
  <section className="panel">
    {(title || actions) && (
      <header className="panel-head">
        <div>
          {title && <div className="panel-title">{title}</div>}
          {note && <div className="panel-note">{note}</div>}
        </div>
        {actions && <div className="right">{actions}</div>}
      </header>
    )}
    {bodyless ? children : <div className="panel-body">{children}</div>}
  </section>
);

export const Stat = ({ label, value, foot, state }) => (
  <div className={`stat ${state || ''}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {foot && <div className="stat-foot">{foot}</div>}
  </div>
);

export const Empty = ({ title, children, action }) => (
  <div className="empty">
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>
);

export const Loading = ({ rows = 5 }) => (
  <div style={{ display: 'grid', gap: 9, padding: 17 }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton" style={{ width: `${95 - i * 7}%` }} />
    ))}
  </div>
);

export const Banner = ({ kind = 'info', children }) => (
  <div className={`banner ${kind}`}>{children}</div>
);

/* ---------------------------------------------------------------- modal */
export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">&times;</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toast */
export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.command ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const node = toast && (
    <div className={`toast ${toast.kind || ''}`} role="status">
      {toast.message}
      {toast.command && <code className="toast-cmd">{toast.command}</code>}
    </div>
  );
  return [node, setToast];
}

/* ---------------------------------------------------------------- misc */
export const Meta = ({ items }) => (
  <div className="meta-grid">
    {items.filter(Boolean).map(([key, value, mono]) => (
      <div className="meta-item" key={key}>
        <div className="meta-key">{key}</div>
        <div className={`meta-val ${mono ? 'mono' : ''}`}>{value ?? '—'}</div>
      </div>
    ))}
  </div>
);

export const Bar = ({ percent, state }) => (
  <div className="bar" title={`${percent}%`}>
    <span className={state || tone(percent > 85 ? 'FAILED' : percent > 65 ? 'DEGRADED' : 'HEALTHY')}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
  </div>
);

/* ---------------------------------------------------------------- dates */
export const when = (iso) => {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

export const stamp = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : '—';

export const secs = (n) => {
  if (n == null) return '—';
  if (n < 60) return `${n}s`;
  return `${Math.floor(n / 60)}m ${n % 60}s`;
};

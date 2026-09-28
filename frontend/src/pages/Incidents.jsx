import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { incidents as api, applications as appApi, users as userApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Pill, Stat, Modal, Loading, Empty, Banner, useToast, when } from '../components/ui';

const BLANK = { title: '', description: '', severity: 'MEDIUM', applicationId: '', assignedTo: '' };

export default function Incidents() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [apps, setApps] = useState([]);
  const [people, setPeople] = useState([]);
  const [filters, setFilters] = useState({ status: '', severity: '' });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();

  const load = () => api.list(filters).then(setRows).catch((e) => setError(errorMessage(e)));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.status, filters.severity]);
  useEffect(() => {
    appApi.list().then(setApps).catch(() => {});
    userApi.list().then(setPeople).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.create({
        title: form.title,
        description: form.description || undefined,
        severity: form.severity,
        applicationId: form.applicationId ? Number(form.applicationId) : undefined,
        assignedTo: form.assignedTo ? Number(form.assignedTo) : undefined,
      });
      setToast({ message: 'Incident opened' });
      setCreating(false);
      setForm(BLANK);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const move = async (row, status) => {
    try {
      await api.update(row.id, { status });
      setToast({ message: `${row.reference} moved to ${status.toLowerCase()}` });
      load();
    } catch (e) {
      setToast({ kind: 'fail', message: errorMessage(e) });
    }
  };

  const count = (pred) => (rows ?? []).filter(pred).length;

  return (
    <>
      <div className="grid g-4 mb-16">
        <Stat label="Open" value={count((i) => i.status === 'OPEN')} foot="not yet picked up"
              state={count((i) => i.status === 'OPEN') ? 'fail' : 'ok'} />
        <Stat label="Investigating" value={count((i) => i.status === 'INVESTIGATING')} foot="someone is on it" state="warn" />
        <Stat label="Critical" value={count((i) => i.severity === 'CRITICAL' && i.status !== 'RESOLVED')}
              foot="unresolved" state={count((i) => i.severity === 'CRITICAL' && i.status !== 'RESOLVED') ? 'fail' : 'ok'} />
        <Stat label="Resolved" value={count((i) => i.status === 'RESOLVED')} foot="closed out" state="ok" />
      </div>

      <Panel
        title="Incidents"
        note={rows ? `${rows.length} total` : 'Loading'}
        bodyless
        actions={
          <>
            <div className="filters">
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Any status</option>
                {['OPEN', 'INVESTIGATING', 'RESOLVED'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </select>
              <select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
                <option value="">Any severity</option>
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </select>
            </div>
            <button className="btn primary sm" onClick={() => { setError(''); setCreating(true); }}>Open incident</button>
          </>
        }
      >
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty title="Nothing broken">No incidents match these filters.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Reference</th><th>Title</th><th>Severity</th><th>Application</th>
                  <th>Status</th><th>Assigned</th><th>Opened</th><th>Resolved</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.reference}</td>
                    <td>
                      <div className="cell-main">{i.title}</div>
                      {i.description && <div className="cell-sub">{i.description}</div>}
                    </td>
                    <td><span className={`sev ${i.severity}`}>{i.severity.toLowerCase()}</span></td>
                    <td>
                      {i.application_id
                        ? <Link to={`/applications/${i.application_id}`} style={{ color: '#F0A93B' }}>{i.application_name}</Link>
                        : <span className="dim">—</span>}
                      {i.environment_name && <div className="cell-sub">{i.environment_name}</div>}
                    </td>
                    <td><Pill value={i.status} /></td>
                    <td>{i.assigned_to_name ?? <span className="dim">Unassigned</span>}</td>
                    <td className="dim nowrap">{when(i.created_at)}</td>
                    <td className="dim nowrap">{i.resolved_at ? when(i.resolved_at) : '—'}</td>
                    <td>
                      {can('DEVELOPER') && (
                        <div className="btn-row">
                          {i.status === 'OPEN' &&
                            <button className="btn sm ghost" onClick={() => move(i, 'INVESTIGATING')}>Investigate</button>}
                          {i.status !== 'RESOLVED' &&
                            <button className="btn sm ghost" onClick={() => move(i, 'RESOLVED')}>Resolve</button>}
                          {i.status === 'RESOLVED' &&
                            <button className="btn sm ghost" onClick={() => move(i, 'OPEN')}>Reopen</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating && (
        <Modal title="Open an incident" onClose={() => setCreating(false)}
               footer={<>
                 <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
                 <button className="btn primary" onClick={save} disabled={saving || form.title.length < 4}>
                   {saving ? 'Opening…' : 'Open incident'}
                 </button>
               </>}>
          {error && <Banner kind="fail">{error}</Banner>}
          <div className="field">
            <label htmlFor="i-title">What is wrong</label>
            <input id="i-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                   placeholder="Checkout API returning 503 in production" />
          </div>
          <div className="field">
            <label htmlFor="i-desc">What you have found so far</label>
            <textarea id="i-desc" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Symptoms, affected users, what you have already checked." />
          </div>
          <div className="field">
            <label htmlFor="i-sev">Severity</label>
            <select id="i-sev" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="CRITICAL">Critical — users are blocked</option>
              <option value="HIGH">High — major feature degraded</option>
              <option value="MEDIUM">Medium — noticeable, has a workaround</option>
              <option value="LOW">Low — cosmetic or internal</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="i-app">Affected application</label>
            <select id="i-app" value={form.applicationId} onChange={(e) => setForm({ ...form, applicationId: e.target.value })}>
              <option value="">Not specific to one</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.environment_name})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="i-who">Assign to</label>
            <select id="i-who" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">Leave unassigned</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

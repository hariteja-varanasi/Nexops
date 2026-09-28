import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { applications as api, environments as envApi, projects as projApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Pill, Dot, Modal, Loading, Empty, Banner, useToast, when } from '../components/ui';

const BLANK = { name: '', projectId: '', environmentId: '', version: 'v0.1.0', replicas: 1, language: 'Node.js', repository: '' };

export default function Applications() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [envs, setEnvs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ environment: '', status: '', search: '' });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();

  const load = () => api.list(filters).then(setRows).catch((e) => setError(errorMessage(e)));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.environment, filters.status]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [filters.search]);
  useEffect(() => {
    envApi.list().then(setEnvs).catch(() => {});
    projApi.list().then(setProjects).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.create({
        name: form.name,
        projectId: Number(form.projectId),
        environmentId: Number(form.environmentId),
        version: form.version || undefined,
        replicas: Number(form.replicas),
        language: form.language || undefined,
        repository: form.repository || undefined,
      });
      setToast({ message: `Created ${form.name}` });
      setCreating(false);
      setForm(BLANK);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Panel
        title="Applications"
        note={rows ? `${rows.length} workload${rows.length === 1 ? '' : 's'}` : 'Loading'}
        bodyless
        actions={
          <>
            <div className="filters">
              <input className="search" placeholder="Search by name" value={filters.search}
                     onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
              <select value={filters.environment}
                      onChange={(e) => setFilters({ ...filters, environment: e.target.value })}>
                <option value="">All environments</option>
                {envs.map((e) => <option key={e.slug} value={e.slug}>{e.name}</option>)}
              </select>
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Any status</option>
                {['RUNNING', 'DEPLOYING', 'PENDING', 'FAILED', 'STOPPED'].map((s) =>
                  <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </select>
            </div>
            {can('DEVELOPER') && <button className="btn primary sm" onClick={() => { setError(''); setCreating(true); }}>New application</button>}
          </>
        }
      >
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty title="No applications match">Clear the filters, or register a workload.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Application</th><th>Version</th><th>Environment</th><th>Status</th>
                  <th>Image</th><th className="num">Pods</th><th>Last deployment</th><th>Commit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/applications/${a.id}`} className="cell-main" style={{ color: '#F0A93B' }}>
                        {a.name}
                      </Link>
                      <div className="cell-sub">{a.project_name} · <span className="mono">{a.k8s_namespace}</span></div>
                    </td>
                    <td className="mono">{a.version}</td>
                    <td>{a.environment_name}</td>
                    <td>
                      <div className="row">
                        <Pill value={a.status} />
                        <span title={`Health: ${a.health}`}><Dot value={a.health} /></span>
                      </div>
                    </td>
                    <td className="mono dim" style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.image_repository}:{a.image_tag}
                    </td>
                    <td className="num">{a.pod_count}/{a.replicas}</td>
                    <td className="dim nowrap">{when(a.last_deployed_at)}</td>
                    <td className="mono dim">{a.git_commit?.slice(0, 7) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating && (
        <Modal
          title="New application"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn primary" onClick={save}
                      disabled={saving || !form.name || !form.projectId || !form.environmentId}>
                {saving ? 'Creating…' : 'Create application'}
              </button>
            </>
          }
        >
          {error && <Banner kind="fail">{error}</Banner>}
          <div className="field">
            <label htmlFor="a-name">Name</label>
            <input id="a-name" value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="payment-service" />
            <span className="hint">Becomes the Deployment and Service name, so Kubernetes rules apply: lowercase letters, numbers and dashes.</span>
          </div>
          <div className="field">
            <label htmlFor="a-project">Project</label>
            <select id="a-project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Choose a project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-env">Environment</label>
            <select id="a-env" value={form.environmentId} onChange={(e) => setForm({ ...form, environmentId: e.target.value })}>
              <option value="">Choose an environment</option>
              {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.namespace})</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="a-ver">Version</label>
              <input id="a-ver" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="a-rep">Replicas</label>
              <input id="a-rep" type="number" min="0" max="20" value={form.replicas}
                     onChange={(e) => setForm({ ...form, replicas: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="a-repo">Repository</label>
            <input id="a-repo" value={form.repository}
                   onChange={(e) => setForm({ ...form, repository: e.target.value })}
                   placeholder="https://github.com/org/repo.git" />
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

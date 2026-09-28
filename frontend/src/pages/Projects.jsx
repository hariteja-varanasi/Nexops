import { useEffect, useState } from 'react';
import { projects as api, environments as envApi, users as userApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Pill, Modal, Loading, Empty, Banner, useToast, when } from '../components/ui';

const BLANK = { name: '', description: '', repository: '', environmentId: '', ownerId: '', status: 'ACTIVE' };

export default function Projects() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [envs, setEnvs] = useState([]);
  const [people, setPeople] = useState([]);
  const [filters, setFilters] = useState({ status: '', search: '' });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();

  const load = () => api.list(filters).then(setRows).catch((e) => setError(errorMessage(e)));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.status]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [filters.search]);
  useEffect(() => {
    envApi.list().then(setEnvs).catch(() => {});
    userApi.list().then(setPeople).catch(() => {});
  }, []);

  const open = (row) => {
    setError('');
    setEditing(row ?? 'new');
    setForm(row ? {
      name: row.name, description: row.description ?? '', repository: row.repository ?? '',
      environmentId: row.environment_id ?? '', ownerId: row.owner_id ?? '', status: row.status,
    } : BLANK);
  };

  const save = async () => {
    setSaving(true); setError('');
    const body = {
      name: form.name,
      description: form.description || undefined,
      repository: form.repository || undefined,
      environmentId: form.environmentId || undefined,
      ownerId: form.ownerId || undefined,
      status: form.status,
    };
    try {
      if (editing === 'new') await api.create(body);
      else await api.update(editing.id, body);
      setToast({ message: editing === 'new' ? `Created ${form.name}` : `Saved ${form.name}` });
      setEditing(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.name}? Its applications and deployment history go with it.`)) return;
    try {
      await api.remove(row.id);
      setToast({ message: `Deleted ${row.name}` });
      load();
    } catch (e) {
      setToast({ kind: 'fail', message: errorMessage(e) });
    }
  };

  return (
    <>
      {error && !editing && <Banner kind="fail">{error}</Banner>}

      <Panel
        title="Projects"
        note={rows ? `${rows.length} project${rows.length === 1 ? '' : 's'}` : 'Loading'}
        bodyless
        actions={
          <>
            <div className="filters">
              <input className="search" placeholder="Search name or description"
                     value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Any status</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
            {can('DEVELOPER') && <button className="btn primary sm" onClick={() => open(null)}>New project</button>}
          </>
        }
      >
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty title="No projects yet"
                 action={can('DEVELOPER') && <button className="btn primary" onClick={() => open(null)}>Create the first project</button>}>
            A project groups the applications that ship together.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th><th>Owner</th><th>Repository</th><th>Environment</th>
                  <th className="num">Apps</th><th className="num">Deploys</th>
                  <th>Status</th><th>Created</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-main">{p.name}</div>
                      {p.description && <div className="cell-sub">{p.description}</div>}
                    </td>
                    <td>{p.owner_name ?? '—'}</td>
                    <td className="mono dim">{p.repository?.replace('https://github.com/', '') ?? '—'}</td>
                    <td>{p.environment_name ?? '—'}</td>
                    <td className="num">{p.application_count}</td>
                    <td className="num">{p.deployment_count}</td>
                    <td><Pill value={p.status} /></td>
                    <td className="dim nowrap">{when(p.created_at)}</td>
                    <td>
                      {can('DEVELOPER') && (
                        <div className="btn-row">
                          <button className="btn sm ghost" onClick={() => open(p)}>Edit</button>
                          {can() && <button className="btn sm danger" onClick={() => remove(p)}>Delete</button>}
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

      {editing && (
        <Modal
          title={editing === 'new' ? 'New project' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={saving || form.name.length < 2}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create project' : 'Save changes'}
              </button>
            </>
          }
        >
          {error && <Banner kind="fail">{error}</Banner>}
          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   placeholder="Customer Portal" />
          </div>
          <div className="field">
            <label htmlFor="p-desc">Description</label>
            <textarea id="p-desc" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="What this project delivers and who uses it." />
          </div>
          <div className="field">
            <label htmlFor="p-repo">Repository</label>
            <input id="p-repo" value={form.repository}
                   onChange={(e) => setForm({ ...form, repository: e.target.value })}
                   placeholder="https://github.com/org/repo.git" />
            <span className="hint">Full clone URL. Jenkins reads the Jenkinsfile from here.</span>
          </div>
          <div className="field">
            <label htmlFor="p-env">Primary environment</label>
            <select id="p-env" value={form.environmentId}
                    onChange={(e) => setForm({ ...form, environmentId: e.target.value })}>
              <option value="">Not set</option>
              {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.namespace})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-owner">Owner</label>
            <select id="p-owner" value={form.ownerId}
                    onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
              <option value="">Unassigned</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-status">Status</label>
            <select id="p-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

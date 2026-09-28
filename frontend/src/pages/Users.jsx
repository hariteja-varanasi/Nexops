import { useEffect, useState } from 'react';
import { users as api } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Pill, Modal, Loading, Banner, useToast, when } from '../components/ui';

const BLANK = { username: '', email: '', fullName: '', password: '', role: 'VIEWER' };

const ROLE_MEANS = {
  ADMIN: 'Everything, including deleting projects and managing users.',
  DEVELOPER: 'Create and edit projects and applications, deploy, scale and roll back.',
  VIEWER: 'Read everything and open incidents. No changes to workloads.',
};

export default function Users() {
  const { can, user: me } = useAuth();
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();

  const load = () => api.list().then(setRows).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.create(form);
      setToast({ message: `Created ${form.username}` });
      setCreating(false);
      setForm(BLANK);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (row, role) => {
    try {
      await api.update(row.id, { role });
      setToast({ message: `${row.username} is now ${role.toLowerCase()}` });
      load();
    } catch (e) {
      setToast({ kind: 'fail', message: errorMessage(e) });
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.username}?`)) return;
    try {
      await api.remove(row.id);
      setToast({ message: `Deleted ${row.username}` });
      load();
    } catch (e) {
      setToast({ kind: 'fail', message: errorMessage(e) });
    }
  };

  return (
    <>
      {error && !creating && <Banner kind="fail">{error}</Banner>}

      <Panel title="Users" note={rows ? `${rows.length} accounts` : 'Loading'} bodyless
             actions={can() && <button className="btn primary sm" onClick={() => { setError(''); setCreating(true); }}>New user</button>}>
        {!rows ? <Loading /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>User</th><th>Email</th><th>Role</th><th>What that allows</th><th>Status</th><th>Last sign-in</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-main">{u.full_name}</div>
                      <div className="cell-sub mono">{u.username}{u.id === me?.id ? ' · you' : ''}</div>
                    </td>
                    <td className="dim">{u.email}</td>
                    <td>
                      {can() && u.id !== me?.id ? (
                        <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} style={{ minWidth: 130 }}>
                          {['ADMIN', 'DEVELOPER', 'VIEWER'].map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : <span className="mono">{u.role}</span>}
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 330 }}>{ROLE_MEANS[u.role]}</td>
                    <td><Pill value={u.is_active ? 'ACTIVE' : 'STOPPED'} label={u.is_active ? 'active' : 'disabled'} /></td>
                    <td className="dim nowrap">{u.last_login_at ? when(u.last_login_at) : 'never'}</td>
                    <td>
                      {can() && u.id !== me?.id &&
                        <button className="btn sm danger" onClick={() => remove(u)}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating && (
        <Modal title="New user" onClose={() => setCreating(false)}
               footer={<>
                 <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
                 <button className="btn primary" onClick={save}
                         disabled={saving || !form.username || !form.email || form.password.length < 8}>
                   {saving ? 'Creating…' : 'Create user'}
                 </button>
               </>}>
          {error && <Banner kind="fail">{error}</Banner>}
          <div className="field">
            <label htmlFor="u-name">Full name</label>
            <input id="u-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-user">Username</label>
            <input id="u-user" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-mail">Email</label>
            <input id="u-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-pass">Password</label>
            <input id="u-pass" type="password" value={form.password}
                   onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <span className="hint">At least 8 characters. Stored as a bcrypt hash, never in plain text.</span>
          </div>
          <div className="field">
            <label htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {['VIEWER', 'DEVELOPER', 'ADMIN'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <span className="hint">{ROLE_MEANS[form.role]}</span>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

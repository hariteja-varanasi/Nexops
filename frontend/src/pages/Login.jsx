import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';

const CHAIN = [
  ['GitHub', 'holds the source and the desired state'],
  ['Jenkins', 'builds, tests and gates every commit'],
  ['SonarQube', 'blocks the merge when quality drops'],
  ['Trivy', 'fails the build on a HIGH CVE'],
  ['Docker Hub', 'stores the signed image'],
  ['Argo CD', 'syncs the cluster to Git'],
  ['kind', 'runs the workloads'],
  ['Grafana', 'shows metrics and logs'],
];

export default function Login() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="brand" style={{ border: 'none', padding: 0, marginBottom: 26 }}>
          <span className="brand-mark">N</span>
          <span className="brand-name" style={{ fontSize: 17 }}>NexOps</span>
        </div>
        <h1>One console for the whole delivery chain</h1>
        <p>
          Every project, image, deployment and pod in the training cluster, plus the
          tool that produced it. Sign in to see the chain running end to end.
        </p>
        <div className="chain">
          {CHAIN.map(([tool, does]) => (
            <div className="chain-row" key={tool}>
              <span className="tool">{tool}</span>
              <span className="does">{does}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="login-main">
        <div className="login-box">
          <h2>Sign in</h2>
          <p className="lede">Use your platform account.</p>

          {error && <div className="banner fail" role="alert">{error}</div>}

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" value={username} autoComplete="username" autoFocus
                     onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} autoComplete="current-password"
                     onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <button className="btn primary" type="submit" disabled={busy || !username || !password}
                    style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="demo-creds">
            Training cluster seed account: <code>admin</code> / <code>admin123</code>.
            Set <code>SEED_ADMIN_PASSWORD</code> before using this anywhere real.
          </div>
        </div>
      </div>
    </div>
  );
}

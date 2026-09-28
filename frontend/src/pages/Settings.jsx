import { useEffect, useState } from 'react';
import { health as healthApi, monitoring, logs } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Panel, Pill, Dot, Meta, Banner } from '../components/ui';

/**
 * Settings is deliberately read-only. It shows how this instance is wired so a
 * student can see which observability backends are live and which are falling
 * back, without guessing from the charts.
 */
export default function Settings() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [metricSource, setMetricSource] = useState(null);
  const [logSource, setLogSource] = useState(null);

  useEffect(() => {
    healthApi.get().then(setHealth).catch(() => setHealth({ status: 'DOWN' }));
    monitoring.overview(1).then((r) => setMetricSource(r)).catch(() => {});
    logs.query({ limit: 1 }).then((r) => setLogSource(r)).catch(() => {});
  }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid g-2">
        <Panel title="Your account">
          <Meta items={[
            ['Name', user?.full_name],
            ['Username', user?.username, true],
            ['Email', user?.email],
            ['Role', <Pill key="r" value="ACTIVE" label={user?.role} />],
          ]} />
        </Panel>

        <Panel title="Backend dependencies" note="Same data the readiness probe returns">
          <Meta items={[
            ['API', <span key="a" className="row"><Dot value={health?.status} /> {health?.status ?? '…'}</span>],
            ['PostgreSQL', <span key="p" className="row"><Dot value={health?.database} /> {health?.database ?? '…'}</span>],
            ['Redis', <span key="r" className="row"><Dot value={health?.redis} /> {health?.redis ?? '…'}</span>],
            ['Version', health?.version, true],
            ['Node environment', health?.environment, true],
            ['Uptime', health ? `${Math.floor(health.uptimeSeconds / 60)} minutes` : '…'],
          ]} />
        </Panel>
      </div>

      <Panel title="Observability wiring"
             note="Which backend is answering right now, and what to set to change it">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Surface</th><th>Answering</th><th>Environment variable</th><th>Effect when unset</th></tr></thead>
            <tbody>
              <tr>
                <td className="cell-main">Monitoring charts</td>
                <td><Pill value={metricSource?.source === 'prometheus' ? 'SUCCESS' : 'PAUSED'}
                          label={metricSource?.source ?? '…'} /></td>
                <td className="mono">PROMETHEUS_URL</td>
                <td className="dim">Charts read the metric_samples table instead of running PromQL.</td>
              </tr>
              <tr>
                <td className="cell-main">Log stream</td>
                <td><Pill value={logSource?.source === 'loki' ? 'SUCCESS' : 'PAUSED'}
                          label={logSource?.source ?? '…'} /></td>
                <td className="mono">LOKI_URL</td>
                <td className="dim">Logs read the application_logs table instead of querying Loki.</td>
              </tr>
              <tr>
                <td className="cell-main">API cache</td>
                <td><Pill value={health?.redis === 'UP' ? 'SUCCESS' : 'PAUSED'}
                          label={health?.redis === 'UP' ? 'redis' : 'disabled'} /></td>
                <td className="mono">REDIS_URL</td>
                <td className="dim">Every request hits PostgreSQL. Slower, still correct.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Where the platform is configured"
             note="Nothing sensitive is stored in the browser or in Git">
        <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.95, color: '#A9BAD6' }}>
          <div>backend/.env                         local development, git-ignored</div>
          <div>.env.example                         the template that is committed</div>
          <div>kubernetes/config/secret.yaml        cluster credentials, created from .env</div>
          <div>helm/nexops/values.yaml              image tags, replicas, resource limits</div>
          <div>gitops/&lt;env&gt;/                        desired state Argo CD reconciles</div>
          <div>Jenkins credentials store            Docker Hub token, Sonar token, kubeconfig</div>
        </div>
        <Banner kind="warn" >
          The seeded <span className="mono">admin</span> account exists so the demo works out of the box.
          Change <span className="mono">SEED_ADMIN_PASSWORD</span> and <span className="mono">JWT_SECRET</span> before
          exposing this to anything but a training cluster.
        </Banner>
      </Panel>
    </div>
  );
}

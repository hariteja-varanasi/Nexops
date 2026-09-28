import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { applications as api, deployments as deployApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Pill, Meta, Modal, Loading, Banner, useToast, when, stamp, secs, Bar } from '../components/ui';

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(null);
  const [version, setVersion] = useState('');
  const [replicas, setReplicas] = useState(1);
  const [toast, setToast] = useToast();

  const load = () => api.get(id)
    .then((a) => { setApp(a); setReplicas(a.replicas); setVersion(bumpPatch(a.version)); })
    .catch((e) => setError(errorMessage(e)));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (error) return <Banner kind="fail">{error}</Banner>;
  if (!app) return <Panel bodyless><Loading rows={7} /></Panel>;

  const act = async (name, fn) => {
    setBusy(name);
    try {
      const result = await fn();
      setToast({
        message: result?.message ?? `${name} finished`,
        command: result?.kubectlEquivalent ?? result?.argocdEquivalent,
      });
      await load();
    } catch (e) {
      setToast({ kind: 'fail', message: errorMessage(e) });
    } finally {
      setBusy('');
      setDialog(null);
    }
  };

  const deploy = () => act('Deploy', async () => {
    const d = await deployApi.create({ applicationId: app.id, version, strategy: 'ROLLING' });
    return { message: `Build #${d.build_number} started for ${app.name} ${version}` };
  });

  const scale = () => act('Scale', async () => {
    const r = await api.scale(app.id, Number(replicas));
    return { message: `${app.name} set to ${replicas} replicas`, kubectlEquivalent: r.kubectlEquivalent };
  });

  const restart = () => act('Restart', async () => {
    const r = await api.restart(app.id);
    return { message: `Restarted ${app.name}`, kubectlEquivalent: r.kubectlEquivalent };
  });

  const rollback = () => act('Rollback', async () => {
    const r = await api.rollback(app.id);
    return { message: `Rolled ${app.name} back to ${r.deployment.version}`, kubectlEquivalent: r.kubectlEquivalent };
  });

  const cpuPct = Math.min(100, Math.round((app.cpu_millicores / 1000) * 100));
  const memPct = Math.min(100, Math.round((app.memory_mb / 1024) * 100));

  return (
    <>
      <div className="crumb">
        <Link to="/applications">Applications</Link> / {app.name}
      </div>
      <div className="row spread wrap mb-16">
        <div className="row" style={{ gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600 }}>{app.name}</h1>
          <Pill value={app.status} />
          <Pill value={app.health} />
          <span className="mono dim">{app.version}</span>
        </div>
        {can('DEVELOPER') && (
          <div className="btn-row">
            <button className="btn primary" disabled={!!busy} onClick={() => setDialog('deploy')}>Deploy</button>
            <button className="btn" disabled={!!busy} onClick={() => setDialog('scale')}>Scale</button>
            <button className="btn" disabled={!!busy} onClick={restart}>{busy === 'Restart' ? 'Restarting…' : 'Restart'}</button>
            <button className="btn danger" disabled={!!busy} onClick={rollback}>{busy === 'Rollback' ? 'Rolling back…' : 'Roll back'}</button>
            <Link className="btn ghost" to={`/logs?app=${app.name}`}>View logs</Link>
            <Link className="btn ghost" to="/monitoring">View metrics</Link>
          </div>
        )}
      </div>

      {app.open_incidents.length > 0 && (
        <Banner kind="fail">
          <div>
            <strong>{app.open_incidents.length} open incident{app.open_incidents.length > 1 ? 's' : ''}.</strong>{' '}
            {app.open_incidents.map((i) => `${i.reference} ${i.title}`).join(' · ')}{' '}
            <Link to="/incidents" style={{ textDecoration: 'underline' }}>Open incidents</Link>
          </div>
        </Banner>
      )}

      <div className="grid g-1-2" style={{ marginBottom: 16 }}>
        <Panel title="Runtime" note="What Kubernetes is running right now">
          <Meta items={[
            ['Pods', `${app.pod_count} of ${app.replicas} ready`],
            ['Namespace', app.k8s_namespace, true],
            ['Deployment', app.k8s_deployment, true],
            ['Service', app.k8s_service, true],
            ['Health', app.health],
            ['Last deployed', when(app.last_deployed_at)],
          ]} />
          <div className="grid g-2 mt-16">
            <div>
              <div className="row spread" style={{ marginBottom: 5, fontSize: 12.5 }}>
                <span>CPU request</span><span className="mono dim">{app.cpu_millicores}m</span>
              </div>
              <Bar percent={cpuPct} />
            </div>
            <div>
              <div className="row spread" style={{ marginBottom: 5, fontSize: 12.5 }}>
                <span>Memory request</span><span className="mono dim">{app.memory_mb}Mi</span>
              </div>
              <Bar percent={memPct} />
            </div>
          </div>
        </Panel>

        <Panel title="Build and source" note="What produced the running image">
          <Meta items={[
            ['Project', <Link key="p" to="/projects" style={{ color: '#F0A93B' }}>{app.project_name}</Link>],
            ['Environment', app.environment_name],
            ['Image repository', app.image_repository, true],
            ['Image tag', app.image_tag, true],
            ['Git commit', app.git_commit, true],
            ['Language', app.language],
            ['Repository', app.repository?.replace('https://github.com/', '') ?? '—', true],
            ['Registered', when(app.created_at)],
          ]} />
        </Panel>
      </div>

      <Panel title="Deployment history" note="Every pipeline run for this application" bodyless>
        {app.deployments.length === 0 ? (
          <div className="empty"><p>No deployments recorded. Use Deploy to start one.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Build</th><th>Version</th><th>Commit</th><th>Strategy</th><th>Status</th><th>Started</th><th className="num">Duration</th><th /></tr>
              </thead>
              <tbody>
                {app.deployments.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">#{d.build_number}</td>
                    <td className="mono">{d.version}</td>
                    <td className="mono dim">{d.git_commit?.slice(0, 7) ?? '—'}</td>
                    <td className="dim">{d.strategy.replace('_', ' ').toLowerCase()}</td>
                    <td><Pill value={d.status} /></td>
                    <td className="dim nowrap">{stamp(d.started_at)}</td>
                    <td className="num dim">{secs(d.duration_seconds)}</td>
                    <td><Link className="btn sm ghost" to={`/deployments/${d.id}`}>Pipeline</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog === 'deploy' && (
        <Modal title={`Deploy ${app.name}`} onClose={() => setDialog(null)}
               footer={<>
                 <button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button>
                 <button className="btn primary" onClick={deploy} disabled={!!busy || !version}>
                   {busy ? 'Starting…' : 'Start deployment'}
                 </button>
               </>}>
          <Banner kind="info">
            This records a pipeline run in NexOps and marks the application as deploying.
            In the full flow Jenkins builds the image and Argo CD applies it to{' '}
            <span className="mono">{app.k8s_namespace}</span>.
          </Banner>
          <div className="field">
            <label htmlFor="d-ver">Version to deploy</label>
            <input id="d-ver" value={version} onChange={(e) => setVersion(e.target.value)} />
            <span className="hint">Currently running {app.version}.</span>
          </div>
        </Modal>
      )}

      {dialog === 'scale' && (
        <Modal title={`Scale ${app.name}`} onClose={() => setDialog(null)}
               footer={<>
                 <button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button>
                 <button className="btn primary" onClick={scale} disabled={!!busy}>
                   {busy ? 'Scaling…' : `Scale to ${replicas}`}
                 </button>
               </>}>
          <div className="field">
            <label htmlFor="s-rep">Replicas</label>
            <input id="s-rep" type="number" min="0" max="20" value={replicas}
                   onChange={(e) => setReplicas(e.target.value)} />
            <span className="hint">Currently {app.replicas}. Equivalent to{' '}
              <span className="mono">kubectl -n {app.k8s_namespace} scale deployment/{app.k8s_deployment} --replicas={replicas}</span>
            </span>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

function bumpPatch(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version || '');
  if (!m) return 'v1.0.0';
  return `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { environments as api } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Panel, Pill, Bar, Loading, Banner, Meta } from '../components/ui';

export default function Environments() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.list().then(setRows).catch((e) => setError(errorMessage(e))); }, []);

  if (error) return <Banner kind="fail">{error}</Banner>;
  if (!rows) return <Panel bodyless><Loading rows={6} /></Panel>;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Banner kind="info">
        Every environment is a namespace in the same kind cluster, so one EC2 box hosts all three.
        Production is marked protected: Argo CD syncs it only after manual approval.
      </Banner>

      <div className="grid g-3">
        {rows.map((e) => (
          <Panel key={e.id} title={e.name} note={e.description}
                 actions={<Pill value={e.health} />}>
            <Meta items={[
              ['Namespace', e.namespace, true],
              ['Cluster', e.cluster, true],
              ['Applications', e.application_count],
              ['Running pods', e.running_pods],
              ['Sync policy', e.is_protected ? 'Manual approval' : 'Automatic'],
              ['Failed workloads', e.failed_apps],
            ]} />
            <div className="grid" style={{ gap: 12, marginTop: 16 }}>
              <div>
                <div className="row spread" style={{ fontSize: 12.5, marginBottom: 5 }}>
                  <span>CPU requested</span>
                  <span className="mono dim">{e.cpu_millicores_used}m of {Math.round(e.cpu_cores * 1000)}m</span>
                </div>
                <Bar percent={e.cpu_percent} />
              </div>
              <div>
                <div className="row spread" style={{ fontSize: 12.5, marginBottom: 5 }}>
                  <span>Memory requested</span>
                  <span className="mono dim">{e.memory_mb_used}Mi of {Math.round(e.memory_gb * 1024)}Mi</span>
                </div>
                <Bar percent={e.memory_percent} />
              </div>
            </div>
            <div className="mt-16">
              <Link className="btn sm ghost" to={`/applications?environment=${e.slug}`}>
                Applications in {e.slug}
              </Link>
            </div>
          </Panel>
        ))}
      </div>

      <Panel title="Namespace commands" note="Run these against the kind cluster to confirm what NexOps reports">
        <div className="mono" style={{ fontSize: 12.5, lineHeight: 2, color: '#A9BAD6' }}>
          {rows.map((e) => (
            <div key={e.id}>kubectl get pods,svc,ingress -n {e.namespace}</div>
          ))}
          <div>kubectl get namespaces -l app.kubernetes.io/part-of=nexops</div>
          <div>kubectl top pods -A</div>
        </div>
      </Panel>
    </div>
  );
}

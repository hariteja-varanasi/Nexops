import { useEffect, useState } from 'react';
import { environments as envApi, health as healthApi } from '../api/endpoints';
import { Panel, Pill, Dot, Meta, Loading, Banner } from '../components/ui';

// The toolchain this platform is built on. Each entry states what it does and
// where it runs, because half the point of NexOps is knowing which box a given
// tool lives on.
const TOOLCHAIN = [
  { name: 'kind', role: 'Kubernetes cluster', where: '1 control-plane + 2 workers, all containers on the EC2 host', port: '6443' },
  { name: 'NGINX Ingress', role: 'HTTP routing into the cluster', where: 'ingress-nginx namespace, hostPort 80/443', port: '80 / 443' },
  { name: 'Jenkins', role: 'CI: build, test, scan, push', where: 'Docker container on the EC2 host', port: '8080' },
  { name: 'SonarQube', role: 'Code quality gate', where: 'Docker container on the EC2 host', port: '9000' },
  { name: 'Trivy', role: 'Image vulnerability scan', where: 'CLI invoked by the Jenkins pipeline', port: '—' },
  { name: 'Docker Hub', role: 'Container registry', where: 'Public registry, hub.docker.com', port: '443' },
  { name: 'Argo CD', role: 'GitOps reconciliation', where: 'argocd namespace inside kind', port: '8081' },
  { name: 'Prometheus', role: 'Metrics collection', where: 'monitoring namespace inside kind', port: '9090' },
  { name: 'Grafana', role: 'Dashboards for metrics and logs', where: 'monitoring namespace inside kind', port: '3000' },
  { name: 'Loki', role: 'Log aggregation', where: 'logging namespace inside kind', port: '3100' },
  { name: 'PostgreSQL', role: 'NexOps system of record', where: 'StatefulSet with a PVC per environment', port: '5432' },
  { name: 'Redis', role: 'Dashboard and API cache', where: 'Deployment inside each namespace', port: '6379' },
];

export default function Infrastructure() {
  const [envs, setEnvs] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    envApi.list().then(setEnvs).catch(() => setEnvs([]));
    healthApi.get().then(setHealth).catch(() => setHealth({ status: 'DOWN' }));
  }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Banner kind="info">
        Everything below runs on a single EC2 instance. The cluster nodes are Docker containers
        created by kind, which is why the whole platform fits on one machine.
      </Banner>

      <div className="grid g-3">
        <Panel title="Cluster" note="kind, from kind-config.yaml">
          <Meta items={[
            ['Cluster name', 'nexops', true],
            ['Nodes', '3 (1 control-plane, 2 workers)'],
            ['Kubernetes', 'v1.29 (kind node image)'],
            ['Ingress', 'ingress-nginx via hostPort'],
            ['Namespaces', envs ? envs.map((e) => e.namespace).join(', ') : '…', true],
          ]} />
        </Panel>

        <Panel title="NexOps API" note="Live readiness probe">
          {!health ? <Loading rows={3} /> : (
            <Meta items={[
              ['Status', <span key="s" className="row"><Dot value={health.status} /> {health.status}</span>],
              ['PostgreSQL', <span key="p" className="row"><Dot value={health.database} /> {health.database}</span>],
              ['Redis', <span key="r" className="row"><Dot value={health.redis} /> {health.redis}</span>],
              ['Version', health.version, true],
              ['Environment', health.environment, true],
              ['Uptime', health.uptimeSeconds ? `${Math.floor(health.uptimeSeconds / 60)}m` : '—'],
            ]} />
          )}
        </Panel>

        <Panel title="Capacity" note="Declared per environment">
          {!envs ? <Loading rows={3} /> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {envs.map((e) => (
                <div key={e.id} className="row spread" style={{ fontSize: 13 }}>
                  <span>{e.name}</span>
                  <span className="mono dim">{e.cpu_cores} vCPU · {e.memory_gb} GiB</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Toolchain" note="Every component in the delivery chain and where it runs" bodyless>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Component</th><th>What it does</th><th>Where it runs</th><th>Port</th></tr></thead>
            <tbody>
              {TOOLCHAIN.map((t) => (
                <tr key={t.name}>
                  <td className="cell-main">{t.name}</td>
                  <td className="dim">{t.role}</td>
                  <td className="dim">{t.where}</td>
                  <td className="mono dim">{t.port}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Provisioning" note="Terraform creates the host this all runs on">
        <div className="mono" style={{ fontSize: 12.5, lineHeight: 2, color: '#A9BAD6' }}>
          <div>cd terraform && terraform init</div>
          <div>terraform plan -var="key_name=your-keypair"</div>
          <div>terraform apply -auto-approve</div>
          <div>ssh -i your-key.pem ubuntu@$(terraform output -raw public_ip)</div>
          <div>./scripts/setup-ec2.sh &amp;&amp; ./setup.sh</div>
        </div>
      </Panel>
    </div>
  );
}

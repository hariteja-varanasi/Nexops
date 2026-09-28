/**
 * The delivery chain NexOps exists to teach, drawn as one continuous band.
 *
 * Stage state comes from the most recent deployment: stages the pipeline has
 * already passed show green, the stage currently executing pulses blue, and a
 * failure stops the band. The last three links (Prometheus, Grafana, Loki)
 * describe the observability path rather than a build step, so they render as
 * a steady watch state rather than a pass/fail.
 */
const CHAIN = [
  { tool: 'Code',       role: 'local commit',  stage: 'Checkout' },
  { tool: 'GitHub',     role: 'source of truth', stage: 'Checkout' },
  { tool: 'Jenkins',    role: 'build + test',  stage: 'Unit Tests' },
  { tool: 'SonarQube',  role: 'quality gate',  stage: 'SonarQube Analysis' },
  { tool: 'Trivy',      role: 'CVE scan',      stage: 'Trivy Scan' },
  { tool: 'Docker',     role: 'image build',   stage: 'Docker Build' },
  { tool: 'Docker Hub', role: 'registry',      stage: 'Push to Docker Hub' },
  { tool: 'Argo CD',    role: 'GitOps sync',   stage: 'Argo CD Sync' },
  { tool: 'kind',       role: 'Kubernetes',    stage: 'Argo CD Sync' },
  { tool: 'Prometheus', role: 'metrics',       watch: true },
  { tool: 'Grafana',    role: 'dashboards',    watch: true },
  { tool: 'Loki',       role: 'logs',          watch: true },
];

const LABEL = { ok: 'passed', run: 'running', fail: 'failed', pending: 'waiting' };

export default function PipelineStrip({ deployment, clusterHealthy = true }) {
  const stages = deployment?.stages ?? [];
  const byName = Object.fromEntries(stages.map((s) => [s.name, s.status]));

  const stateFor = (link) => {
    if (link.watch) return clusterHealthy ? 'ok' : 'fail';
    if (!deployment) return 'pending';
    const status = byName[link.stage];
    if (status === 'SUCCESS') return 'ok';
    if (status === 'RUNNING') return 'run';
    if (status === 'FAILED') return 'fail';
    return 'pending';
  };

  const subtitle = deployment
    ? `Build #${deployment.build_number} · ${deployment.application_name} ${deployment.version} → ${deployment.environment_name}`
    : 'No deployment recorded yet. Push a commit to start the chain.';

  return (
    <div className="pipeline">
      <div className="pipeline-head">
        <h2>Delivery chain</h2>
        <p>{subtitle}</p>
      </div>
      <div className="pipeline-track">
        {CHAIN.map((link) => {
          const state = stateFor(link);
          return (
            <div key={link.tool} className={`stage ${state}`}>
              <span className="stage-tool">{link.tool}</span>
              <span className="stage-role">{link.role}</span>
              <span className="stage-state">{link.watch ? 'watching' : LABEL[state]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

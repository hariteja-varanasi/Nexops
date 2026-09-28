import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deployments as api } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Panel, Pill, Meta, Loading, Banner, stamp, secs } from '../components/ui';

const MARK = { SUCCESS: '✓', FAILED: '✕', RUNNING: '•', SKIPPED: '–', PENDING: '' };
const CLASS = { SUCCESS: 'ok', FAILED: 'fail', RUNNING: 'run', SKIPPED: '', PENDING: '' };

// What each stage actually does, so the pipeline page doubles as the teaching
// material for the chain.
const EXPLAIN = {
  'Checkout': 'Jenkins clones the commit that triggered the build.',
  'Install Dependencies': 'npm ci in both frontend and backend, from the lockfile.',
  'Lint': 'ESLint. Style problems fail here rather than in review.',
  'Unit Tests': 'node --test against the API, with coverage written for SonarQube.',
  'SonarQube Analysis': 'Bugs, vulnerabilities, code smells, duplication and coverage. The quality gate can stop the build.',
  'Docker Build': 'Multi-stage build producing the frontend and backend images.',
  'Trivy Scan': 'Image CVE scan. HIGH and CRITICAL findings fail the build.',
  'Push to Docker Hub': 'Tags the image with the build number and the commit SHA, then pushes.',
  'Update GitOps Manifest': 'Writes the new tag into gitops/<env>/ and commits it. This is the handover from CI to CD.',
  'Argo CD Sync': 'Argo CD notices the Git change and reconciles the cluster to match.',
};

export default function DeploymentDetail() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api.get(id).then(setD).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id]);

  if (error) return <Banner kind="fail">{error}</Banner>;
  if (!d) return <Panel bodyless><Loading rows={8} /></Panel>;

  const failedStage = d.stages.find((s) => s.status === 'FAILED');

  return (
    <>
      <div className="crumb"><Link to="/deployments">Deployments</Link> / build #{d.build_number}</div>
      <div className="row spread wrap mb-16">
        <div className="row" style={{ gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600 }}>
            {d.application_name} <span className="mono dim" style={{ fontSize: 16 }}>{d.version}</span>
          </h1>
          <Pill value={d.status} />
        </div>
        <Link className="btn ghost" to={`/applications/${d.application_id}`}>Open application</Link>
      </div>

      {failedStage && (
        <Banner kind="fail">
          Stopped at <strong>{failedStage.name}</strong>. Nothing after it ran, so the cluster is
          still on the previous version. Check the Jenkins console output for that stage.
        </Banner>
      )}

      <div className="grid g-2-1">
        <Panel title="Pipeline" note="Each stage as Jenkins reported it">
          <div className="flow">
            {d.stages.map((s) => (
              <div className={`flow-step ${CLASS[s.status] || ''}`} key={s.name}>
                <span className="flow-mark">{MARK[s.status] ?? ''}</span>
                <div>
                  <div className="flow-name">{s.name}</div>
                  <div className="cell-sub">{EXPLAIN[s.name]}</div>
                </div>
                <span className="flow-dur">
                  {s.status === 'PENDING' ? 'waiting'
                    : s.status === 'SKIPPED' ? 'skipped'
                    : `${(s.durationMs / 1000).toFixed(1)}s`}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Run">
            <Meta items={[
              ['Build number', `#${d.build_number}`, true],
              ['Status', <Pill key="s" value={d.status} />],
              ['Strategy', d.strategy.replace('_', ' ').toLowerCase()],
              ['Triggered by', d.triggered_by ?? 'jenkins'],
              ['Started', stamp(d.started_at)],
              ['Completed', stamp(d.completed_at)],
              ['Duration', secs(d.duration_seconds)],
            ]} />
          </Panel>
          <Panel title="Artifact">
            <Meta items={[
              ['Version', d.version, true],
              ['Image tag', d.image_tag, true],
              ['Git branch', d.git_branch, true],
              ['Git commit', d.git_commit, true],
              ['Namespace', d.k8s_namespace, true],
              ['Environment', d.environment_name],
            ]} />
            {d.notes && <div className="banner warn mt-16" style={{ marginBottom: 0 }}>{d.notes}</div>}
          </Panel>
        </div>
      </div>
    </>
  );
}

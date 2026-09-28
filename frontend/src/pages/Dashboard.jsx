import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { dashboard, deployments as deploymentsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import PipelineStrip from '../components/PipelineStrip';
import { Panel, Stat, Pill, Loading, Banner, Bar as MiniBar, when, secs } from '../components/ui';

const STATUS_FILL = {
  SUCCESS: '#35C77F', RUNNING: '#4C9EF5', FAILED: '#F0605F',
  ROLLED_BACK: '#E8B23C', PENDING: '#5C6E8C',
};

const chartAxis = { stroke: '#7D91B3', fontSize: 11, tickLine: false, axisLine: false };
const tooltipStyle = {
  contentStyle: { background: '#16223A', border: '1px solid #24334F', borderRadius: 7, fontSize: 12 },
  labelStyle: { color: '#E4ECF8' },
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => {
      dashboard.stats().then(setData).catch((e) => setError(errorMessage(e)));
      deploymentsApi.list({ limit: 1 }).then((d) => setLatest(d[0] ?? null)).catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Banner kind="fail">{error}</Banner>;
  if (!data) return <Panel bodyless><Loading rows={8} /></Panel>;

  const { totals, applicationsByEnvironment, deploymentStatus, recentDeployments, recentActivity, clusterResources } = data;
  const failed = deploymentStatus.find((s) => s.status === 'FAILED')?.count ?? 0;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PipelineStrip deployment={latest} clusterHealthy={totals.open_incidents === 0} />

      <div className="grid g-4">
        <Stat label="Projects" value={totals.projects} foot="active" state="accent" />
        <Stat label="Applications" value={totals.applications}
              foot={`${applicationsByEnvironment.reduce((s, e) => s + e.pods, 0)} pods`} state="ok" />
        <Stat label="Deployments" value={totals.deployments}
              foot={`${failed} failed in 30d`} state={failed > 0 ? 'warn' : 'ok'} />
        <Stat label="Environments" value={totals.environments} foot="dev · staging · prod" />
        <Stat label="Deployment success" value={`${totals.uptimePercent}%`}
              foot="last 30 days" state={totals.uptimePercent >= 95 ? 'ok' : totals.uptimePercent >= 80 ? 'warn' : 'fail'} />
        <Stat label="Open incidents" value={totals.open_incidents}
              foot={totals.open_incidents ? 'needs attention' : 'all clear'}
              state={totals.open_incidents ? 'fail' : 'ok'} />
        <Stat label="Cluster CPU" value={`${clusterResources.cpu.percent}%`}
              foot={`${clusterResources.cpu.used} / ${clusterResources.cpu.total} m`} />
        <Stat label="Cluster memory" value={`${clusterResources.memory.percent}%`}
              foot={`${clusterResources.memory.used} / ${clusterResources.memory.total} MiB`} />
      </div>

      <div className="grid g-2-1">
        <Panel title="Applications by environment" note="Workload and pod distribution across namespaces">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={applicationsByEnvironment} barGap={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2740" vertical={false} />
              <XAxis dataKey="environment" {...chartAxis} />
              <YAxis {...chartAxis} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(76,158,245,.07)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="applications" name="Applications" fill="#F0A93B" radius={[3, 3, 0, 0]} />
              <Bar dataKey="pods" name="Pods" fill="#4C9EF5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Deployment outcomes" note="Last 30 days">
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={deploymentStatus} dataKey="count" nameKey="status"
                   innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
                {deploymentStatus.map((s) => (
                  <Cell key={s.status} fill={STATUS_FILL[s.status] || '#5C6E8C'} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v.replace(/_/g, ' ').toLowerCase()} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid g-2-1">
        <Panel title="Recent deployments" bodyless
               actions={<Link className="btn sm ghost" to="/deployments">All deployments</Link>}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Application</th><th>Version</th><th>Environment</th>
                  <th>Build</th><th>Commit</th><th>Status</th><th>Started</th><th>Took</th>
                </tr>
              </thead>
              <tbody>
                {recentDeployments.map((d) => (
                  <tr key={d.id}>
                    <td className="cell-main">{d.application_name}</td>
                    <td className="mono">{d.version}</td>
                    <td>{d.environment_name}</td>
                    <td className="mono">#{d.build_number}</td>
                    <td className="mono dim">{d.git_commit?.slice(0, 7)}</td>
                    <td><Pill value={d.status} /></td>
                    <td className="dim nowrap">{when(d.started_at)}</td>
                    <td className="num dim">{secs(d.duration_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Cluster resources" note="Requested against the capacity declared per environment">
            <div style={{ display: 'grid', gap: 14 }}>
              {['cpu', 'memory'].map((k) => (
                <div key={k}>
                  <div className="row spread" style={{ marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5 }}>{k === 'cpu' ? 'CPU' : 'Memory'}</span>
                    <span className="mono dim">
                      {clusterResources[k].used} / {clusterResources[k].total} {clusterResources[k].unit}
                    </span>
                  </div>
                  <MiniBar percent={clusterResources[k].percent} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Recent activity" note="Audit trail">
            <div style={{ display: 'grid', gap: 10 }}>
              {recentActivity.length === 0 && <span className="dim">Nothing recorded yet.</span>}
              {recentActivity.map((a) => (
                <div key={a.id} style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                  <span className="mono" style={{ color: '#F0A93B' }}>{a.username}</span>{' '}
                  <span className="dim">{a.summary || a.action.toLowerCase().replace(/_/g, ' ')}</span>
                  <div className="dim" style={{ fontSize: 11 }}>{when(a.created_at)}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

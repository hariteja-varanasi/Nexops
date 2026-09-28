import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deployments as api, environments as envApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Panel, Pill, Loading, Empty, Banner, stamp, secs } from '../components/ui';

export default function Deployments() {
  const [rows, setRows] = useState(null);
  const [envs, setEnvs] = useState([]);
  const [filters, setFilters] = useState({ environment: '', status: '', limit: 60 });
  const [error, setError] = useState('');

  useEffect(() => {
    api.list(filters).then(setRows).catch((e) => setError(errorMessage(e)));
    /* eslint-disable-next-line */
  }, [filters.environment, filters.status, filters.limit]);
  useEffect(() => { envApi.list().then(setEnvs).catch(() => {}); }, []);

  if (error) return <Banner kind="fail">{error}</Banner>;

  return (
    <Panel
      title="Deployment history"
      note={rows ? `${rows.length} runs` : 'Loading'}
      bodyless
      actions={
        <div className="filters">
          <select value={filters.environment} onChange={(e) => setFilters({ ...filters, environment: e.target.value })}>
            <option value="">All environments</option>
            {envs.map((e) => <option key={e.slug} value={e.slug}>{e.name}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Any outcome</option>
            {['SUCCESS', 'RUNNING', 'FAILED', 'ROLLED_BACK', 'PENDING'].map((s) =>
              <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </select>
          <select value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value) })}>
            {[25, 60, 150].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </select>
        </div>
      }
    >
      {!rows ? <Loading /> : rows.length === 0 ? (
        <Empty title="No deployments match">Adjust the filters to see more history.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Build</th><th>Application</th><th>Version</th><th>Environment</th>
                <th>Branch</th><th>Commit</th><th>Strategy</th><th>Status</th>
                <th>Started</th><th>Completed</th><th className="num">Duration</th><th>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td><Link className="mono" style={{ color: '#F0A93B' }} to={`/deployments/${d.id}`}>#{d.build_number}</Link></td>
                  <td className="cell-main">{d.application_name}</td>
                  <td className="mono">{d.version}</td>
                  <td>{d.environment_name}</td>
                  <td className="mono dim">{d.git_branch}</td>
                  <td className="mono dim">{d.git_commit?.slice(0, 7) ?? '—'}</td>
                  <td className="dim">{d.strategy.replace('_', ' ').toLowerCase()}</td>
                  <td><Pill value={d.status} /></td>
                  <td className="dim nowrap">{stamp(d.started_at)}</td>
                  <td className="dim nowrap">{stamp(d.completed_at)}</td>
                  <td className="num dim">{secs(d.duration_seconds)}</td>
                  <td className="dim">{d.triggered_by ?? 'jenkins'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

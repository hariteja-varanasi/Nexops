import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { logs as api } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Panel, Loading, Empty, Banner, stamp } from '../components/ui';

export default function Logs() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState(null);
  const [facets, setFacets] = useState({ apps: [], namespaces: [], levels: [] });
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);

  const filters = {
    app: params.get('app') ?? '',
    namespace: params.get('namespace') ?? '',
    level: params.get('level') ?? '',
    search: params.get('search') ?? '',
    since: Number(params.get('since') ?? 1440),
    limit: 200,
  };

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const load = () => api.query(filters).then(setResult).catch((e) => setError(errorMessage(e)));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.toString()]);
  useEffect(() => { api.facets().then(setFacets).catch(() => {}); }, []);
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [live, params.toString()]);

  if (error) return <Banner kind="fail">{error}</Banner>;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {result?.source === 'database' && (
        <Banner kind="warn">
          <div>
            <strong>Showing stored log lines, not live Loki.</strong> The response reports{' '}
            <span className="mono">source: "{result.source}"</span>
            {result.fallbackReason
              ? <> because the Loki query failed: <span className="mono">{result.fallbackReason}</span></>
              : <> because <span className="mono">LOKI_URL</span> is not set</>}.
            Install the logging stack and set that variable to query the cluster instead.
          </div>
        </Banner>
      )}
      {result?.source === 'loki' && (
        <Banner kind="info">
          Live from Loki at <span className="mono">{result.endpoint}</span>. The same lines appear in
          Grafana under the Loki data source.
        </Banner>
      )}

      <Panel
        title="Log stream"
        note={result ? `${result.count} lines · source: ${result.source}` : 'Loading'}
        bodyless
        actions={
          <>
            <div className="filters">
              <input className="search" placeholder="Search message text" value={filters.search}
                     onChange={(e) => setFilter('search', e.target.value)} />
              <select value={filters.app} onChange={(e) => setFilter('app', e.target.value)}>
                <option value="">All applications</option>
                {facets.apps.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={filters.namespace} onChange={(e) => setFilter('namespace', e.target.value)}>
                <option value="">All namespaces</option>
                {facets.namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={filters.level} onChange={(e) => setFilter('level', e.target.value)}>
                <option value="">Any level</option>
                {['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select value={filters.since} onChange={(e) => setFilter('since', e.target.value)}>
                <option value="60">Last hour</option>
                <option value="360">Last 6 hours</option>
                <option value="1440">Last 24 hours</option>
                <option value="10080">Last 7 days</option>
              </select>
            </div>
            <button className={`btn sm ${live ? 'primary' : 'ghost'}`} onClick={() => setLive((v) => !v)}>
              {live ? 'Streaming' : 'Stream'}
            </button>
          </>
        }
      >
        {!result ? <Loading rows={10} /> : result.entries.length === 0 ? (
          <Empty title="No log lines match">Widen the time window or clear a filter.</Empty>
        ) : (
          <div style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            {result.entries.map((e, i) => (
              <div className="log-line" key={`${e.ts}-${i}`}>
                <span className="log-ts">{stamp(e.ts)}</span>
                <span className={`log-lvl ${e.level}`}>{e.level}</span>
                <span>
                  <span className="log-msg">{e.message}</span>
                  <div className="log-pod">{e.namespace}/{e.pod} · {e.container}</div>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="The same query in Grafana"
             note="Once Loki is installed, paste this into the Explore tab to see identical results">
        <div className="mono" style={{ fontSize: 12.5, color: '#A9BAD6', lineHeight: 1.9 }}>
          <div>
            {'{job="nexops"'}
            {filters.app && `, app="${filters.app}"`}
            {filters.namespace && `, namespace="${filters.namespace}"`}
            {'}'}
            {filters.level && ` | level = "${filters.level}"`}
            {filters.search && ` |= "${filters.search}"`}
          </div>
          <div className="dim">kubectl -n {filters.namespace || 'nexops-dev'} logs -l app={filters.app || 'nexops-backend'} --tail=100 -f</div>
        </div>
      </Panel>
    </div>
  );
}

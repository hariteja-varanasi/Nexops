import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { monitoring as api } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Panel, Stat, Loading, Banner } from '../components/ui';

const axis = { stroke: '#7D91B3', fontSize: 11, tickLine: false, axisLine: false };
const tip = {
  contentStyle: { background: '#16223A', border: '1px solid #24334F', borderRadius: 7, fontSize: 12 },
  labelStyle: { color: '#E4ECF8' },
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function Monitoring() {
  const [data, setData] = useState(null);
  const [hours, setHours] = useState(6);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api.overview(hours).then(setData).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [hours]);

  if (error) return <Banner kind="fail">{error}</Banner>;
  if (!data) return <Panel bodyless><Loading rows={8} /></Panel>;

  const s = (name) => (data.series[name] ?? []).map((p) => ({ t: clock(p.ts), value: p.value }));
  const c = data.current;

  const trafficData = (data.series.http_requests_per_min ?? []).map((p, i) => ({
    t: clock(p.ts),
    requests: p.value,
    errors: data.series.http_errors_per_min?.[i]?.value ?? 0,
  }));

  return (
    <div className="grid" style={{ gap: 16 }}>
      {data.source === 'database' && (
        <Banner kind="warn">
          <div>
            <strong>Showing stored samples, not live Prometheus.</strong> The backend reports{' '}
            <span className="mono">source: "{data.source}"</span> because{' '}
            <span className="mono">PROMETHEUS_URL</span> is not set. Install the monitoring stack and set that
            variable, and these charts switch to PromQL against the cluster with no other change.
          </div>
        </Banner>
      )}
      {data.source === 'prometheus' && (
        <Banner kind="info">
          Live from Prometheus. Each chart maps to one PromQL query, listed in{' '}
          <span className="mono">backend/src/services/monitoringService.js</span>.
        </Banner>
      )}

      <div className="row spread wrap">
        <div className="dim" style={{ fontSize: 13 }}>
          Window: last {hours} hours · refreshes every 30 seconds
        </div>
        <div className="filters">
          {[1, 6, 24].map((h) => (
            <button key={h} className={`btn sm ${hours === h ? 'primary' : 'ghost'}`} onClick={() => setHours(h)}>
              {h}h
            </button>
          ))}
        </div>
      </div>

      <div className="grid g-4">
        <Stat label="CPU usage" value={`${c.cpu_usage_percent}%`} foot="cluster wide"
              state={c.cpu_usage_percent > 80 ? 'fail' : c.cpu_usage_percent > 60 ? 'warn' : 'ok'} />
        <Stat label="Memory usage" value={`${c.memory_usage_percent}%`} foot="cluster wide"
              state={c.memory_usage_percent > 80 ? 'fail' : c.memory_usage_percent > 60 ? 'warn' : 'ok'} />
        <Stat label="Disk usage" value={`${c.disk_usage_percent}%`} foot="node volumes"
              state={c.disk_usage_percent > 80 ? 'fail' : 'ok'} />
        <Stat label="Pods" value={c.pod_count} foot={`${c.node_count} nodes`} />
        <Stat label="Requests" value={Math.round(c.http_requests_per_min)} foot="per minute" state="accent" />
        <Stat label="Errors" value={Math.round(c.http_errors_per_min)} foot="per minute"
              state={c.http_errors_per_min > 10 ? 'fail' : c.http_errors_per_min > 0 ? 'warn' : 'ok'} />
        <Stat label="Response time" value={`${Math.round(c.response_time_ms)}ms`} foot="p95"
              state={c.response_time_ms > 500 ? 'fail' : c.response_time_ms > 250 ? 'warn' : 'ok'} />
        <Stat label="Failed workloads" value={c.failed_count} foot={`of ${c.application_count} applications`}
              state={c.failed_count ? 'fail' : 'ok'} />
      </div>

      <div className="grid g-2">
        <Panel title="CPU over time" note="Percent of cluster capacity">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={s('cpu_usage_percent')}>
              <defs>
                <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F0A93B" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#F0A93B" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2740" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={44} />
              <YAxis {...axis} domain={[0, 100]} unit="%" />
              <Tooltip {...tip} />
              <Area type="monotone" dataKey="value" name="CPU %" stroke="#F0A93B" strokeWidth={2} fill="url(#gCpu)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Memory over time" note="Percent of cluster capacity">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={s('memory_usage_percent')}>
              <defs>
                <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4C9EF5" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#4C9EF5" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2740" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={44} />
              <YAxis {...axis} domain={[0, 100]} unit="%" />
              <Tooltip {...tip} />
              <Area type="monotone" dataKey="value" name="Memory %" stroke="#4C9EF5" strokeWidth={2} fill="url(#gMem)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="HTTP traffic and errors" note="Requests and errors per minute on the same axis, so a spike in one is visible against the other">
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={trafficData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1B2740" vertical={false} />
            <XAxis dataKey="t" {...axis} minTickGap={44} />
            <YAxis yAxisId="l" {...axis} />
            <YAxis yAxisId="r" orientation="right" {...axis} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="l" type="monotone" dataKey="requests" name="Requests/min"
                  stroke="#35C77F" strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="errors" name="Errors/min"
                  stroke="#F0605F" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <div className="grid g-2">
        <Panel title="Response time" note="p95 latency in milliseconds">
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={s('response_time_ms')}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2740" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={44} />
              <YAxis {...axis} unit="ms" />
              <Tooltip {...tip} />
              <Line type="monotone" dataKey="value" name="p95" stroke="#E8B23C" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Deployment frequency" note="Runs per day over the last two weeks">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={data.deploymentFrequency}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2740" vertical={false} />
              <XAxis dataKey="day" {...axis} minTickGap={20}
                     tickFormatter={(d) => d.slice(5)} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip {...tip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="success" name="Succeeded" stackId="a" fill="#35C77F" radius={[0, 0, 0, 0]} />
              <Bar dataKey="failed" name="Failed" stackId="a" fill="#F0605F" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

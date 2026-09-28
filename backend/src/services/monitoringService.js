'use strict';
const db = require('../config/db');
const env = require('../config/env');
const cache = require('../config/redis');
const logger = require('../config/logger');

/**
 * Metrics with two backends, same contract as logService.
 *
 * 1. PROMETHEUS_URL set   -> PromQL via /api/v1/query and /api/v1/query_range.
 * 2. PROMETHEUS_URL unset -> reads metric_samples. source="database".
 */
const PROM_QUERIES = {
  cpu_usage_percent:
    '100 * sum(rate(container_cpu_usage_seconds_total{namespace=~"nexops-.*"}[5m])) / sum(machine_cpu_cores)',
  memory_usage_percent:
    '100 * sum(container_memory_working_set_bytes{namespace=~"nexops-.*"}) / sum(machine_memory_bytes)',
  http_requests_per_min:
    '60 * sum(rate(nexops_http_requests_total[5m]))',
  http_errors_per_min:
    '60 * sum(rate(nexops_http_errors_total[5m]))',
  response_time_ms:
    '1000 * histogram_quantile(0.95, sum(rate(nexops_http_request_duration_seconds_bucket[5m])) by (le))',
};

async function promQuery(path, params) {
  const url = new URL(path, env.prometheusUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Prometheus responded ${res.status}`);
  const body = await res.json();
  if (body.status !== 'success') throw new Error(`Prometheus error: ${body.error}`);
  return body.data;
}

async function seriesFromPrometheus(metric, hours) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - hours * 3600;
  const data = await promQuery('/api/v1/query_range', {
    query: PROM_QUERIES[metric], start, end, step: '300',
  });
  const result = data.result?.[0]?.values ?? [];
  return result.map(([ts, value]) => ({
    ts: new Date(ts * 1000).toISOString(),
    value: Number(Number(value).toFixed(2)),
  }));
}

async function seriesFromDatabase(metric, hours) {
  const { rows } = await db.query(
    `SELECT ts, value::float AS value FROM metric_samples
      WHERE metric = $1 AND ts > now() - ($2 || ' hours')::interval
      ORDER BY ts`, [metric, hours]);
  return rows.map((r) => ({ ts: r.ts, value: r.value }));
}

async function series(metric, hours = 6) {
  if (!PROM_QUERIES[metric]) return { metric, source: 'database', points: [] };
  if (env.prometheusUrl) {
    try {
      return { metric, source: 'prometheus', points: await seriesFromPrometheus(metric, hours) };
    } catch (err) {
      logger.warn({ err: err.message, metric }, 'prometheus query failed - falling back to database');
    }
  }
  return { metric, source: 'database', points: await seriesFromDatabase(metric, hours) };
}

async function overview(hours = 6) {
  const cacheKey = `nexops:monitoring:overview:${hours}`;
  const cached = await cache.getJson(cacheKey);
  if (cached) return { ...cached, cached: true };

  const metrics = ['cpu_usage_percent', 'memory_usage_percent', 'disk_usage_percent',
    'http_requests_per_min', 'http_errors_per_min', 'response_time_ms'];
  const seriesList = await Promise.all(metrics.map((m) => series(m, hours)));

  const current = {};
  for (const s of seriesList) {
    current[s.metric] = s.points.length ? s.points[s.points.length - 1].value : 0;
  }

  const { rows: counts } = await db.query(`
    SELECT COALESCE(sum(pod_count),0)::int          AS pod_count,
           count(*)::int                            AS application_count,
           count(*) FILTER (WHERE status='FAILED')::int AS failed_count
      FROM applications`);

  const { rows: freq } = await db.query(`
    SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
           count(*)::int AS total,
           count(*) FILTER (WHERE status='SUCCESS')::int AS success,
           count(*) FILTER (WHERE status='FAILED')::int  AS failed
      FROM deployments WHERE started_at > now() - interval '14 days'
     GROUP BY 1 ORDER BY 1`);

  const payload = {
    source: seriesList[0]?.source ?? 'database',
    prometheusConfigured: Boolean(env.prometheusUrl),
    windowHours: hours,
    current: {
      ...current,
      pod_count: counts[0].pod_count,
      node_count: 3, // kind: 1 control-plane + 2 workers, see kind-config.yaml
      application_count: counts[0].application_count,
      failed_count: counts[0].failed_count,
    },
    series: Object.fromEntries(seriesList.map((s) => [s.metric, s.points])),
    deploymentFrequency: freq,
  };
  await cache.setJson(cacheKey, payload, 20);
  return payload;
}

module.exports = { overview, series, PROM_QUERIES };

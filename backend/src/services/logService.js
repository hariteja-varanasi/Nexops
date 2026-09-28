'use strict';
const db = require('../config/db');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Log query with two backends.
 *
 * 1. LOKI_URL set   -> queries Loki's /loki/api/v1/query_range. source="loki".
 * 2. LOKI_URL unset -> reads the application_logs table. source="database".
 *
 * The response always states which backend answered so nothing is passed off
 * as live cluster data when it is not.
 */
async function queryLoki({ app, namespace, level, limit, since }) {
  const selectors = ['job="nexops"'];
  if (app) selectors.push(`app="${app}"`);
  if (namespace) selectors.push(`namespace="${namespace}"`);
  let query = `{${selectors.join(',')}}`;
  if (level) query += ` | level = "${level}"`;

  const url = new URL('/loki/api/v1/query_range', env.lokiUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('start', String((Date.now() - since * 60_000) * 1e6));
  url.searchParams.set('end', String(Date.now() * 1e6));

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Loki responded ${res.status}`);
  const body = await res.json();

  const entries = [];
  for (const stream of body.data?.result ?? []) {
    for (const [ns, line] of stream.values) {
      entries.push({
        ts: new Date(Number(ns) / 1e6).toISOString(),
        namespace: stream.stream.namespace ?? namespace ?? '-',
        pod: stream.stream.pod ?? '-',
        container: stream.stream.container ?? '-',
        app: stream.stream.app ?? app ?? '-',
        level: (stream.stream.level ?? 'INFO').toUpperCase(),
        message: line,
      });
    }
  }
  entries.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return entries.slice(0, limit);
}

async function queryDatabase({ app, namespace, pod, level, limit, since, search }) {
  const where = [`ts > now() - ($1 || ' minutes')::interval`];
  const params = [since];
  if (app)       { params.push(app);            where.push(`app = $${params.length}`); }
  if (namespace) { params.push(namespace);      where.push(`namespace = $${params.length}`); }
  if (pod)       { params.push(pod);            where.push(`pod = $${params.length}`); }
  if (level)     { params.push(level);          where.push(`level = $${params.length}`); }
  if (search)    { params.push(`%${search}%`);  where.push(`message ILIKE $${params.length}`); }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT ts, namespace, pod, container, app, level, message
       FROM application_logs WHERE ${where.join(' AND ')}
      ORDER BY ts DESC LIMIT $${params.length}`, params);
  return rows;
}

async function query(filters) {
  const opts = {
    app: filters.app, namespace: filters.namespace, pod: filters.pod,
    level: filters.level, search: filters.search,
    limit: filters.limit ?? 200, since: filters.since ?? 1440,
  };
  if (env.lokiUrl) {
    try {
      const entries = await queryLoki(opts);
      return { source: 'loki', endpoint: env.lokiUrl, count: entries.length, entries };
    } catch (err) {
      logger.warn({ err: err.message }, 'loki query failed - falling back to database');
      const entries = await queryDatabase(opts);
      return { source: 'database', fallbackReason: err.message, count: entries.length, entries };
    }
  }
  const entries = await queryDatabase(opts);
  return { source: 'database', endpoint: null, count: entries.length, entries };
}

async function facets() {
  const { rows: apps } = await db.query('SELECT DISTINCT app FROM application_logs ORDER BY app');
  const { rows: namespaces } = await db.query('SELECT DISTINCT namespace FROM application_logs ORDER BY namespace');
  const { rows: levels } = await db.query(
    `SELECT level, count(*)::int AS count FROM application_logs
      WHERE ts > now() - interval '24 hours' GROUP BY level ORDER BY count DESC`);
  return {
    apps: apps.map((r) => r.app),
    namespaces: namespaces.map((r) => r.namespace),
    levels,
  };
}

module.exports = { query, facets };

'use strict';
const client = require('prom-client');
const env = require('../config/env');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'nexops_' });

const httpRequestsTotal = new client.Counter({
  name: 'nexops_http_requests_total',
  help: 'Total HTTP requests handled by the NexOps API',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const httpErrorsTotal = new client.Counter({
  name: 'nexops_http_errors_total',
  help: 'Total HTTP responses with a 4xx or 5xx status',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const httpRequestDuration = new client.Histogram({
  name: 'nexops_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const activeRequests = new client.Gauge({
  name: 'nexops_http_active_requests',
  help: 'Number of in-flight HTTP requests',
  registers: [registry],
});

const deploymentsTotal = new client.Counter({
  name: 'nexops_deployments_total',
  help: 'Deployments recorded by NexOps',
  labelNames: ['environment', 'status'],
  registers: [registry],
});

const appInfo = new client.Gauge({
  name: 'nexops_app_info',
  help: 'Static build information, always 1',
  labelNames: ['version', 'node_version', 'environment'],
  registers: [registry],
});
appInfo.labels(env.version, process.version, env.nodeEnv).set(1);

function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  activeRequests.inc();
  res.on('finish', () => {
    // Use the matched Express route pattern, not the raw URL, so /api/projects/7
    // and /api/projects/9 collapse into one low-cardinality label.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    if (res.statusCode >= 400) httpErrorsTotal.inc(labels);
    end(labels);
    activeRequests.dec();
  });
  next();
}

module.exports = { registry, metricsMiddleware, deploymentsTotal };

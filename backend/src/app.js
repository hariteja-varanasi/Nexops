'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const env = require('./config/env');
const routes = require('./routes');
const requestLogger = require('./middleware/requestLogger');
const { metricsMiddleware } = require('./middleware/metrics');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Behind the NGINX Ingress, so trust the proxy for client IPs and rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: env.corsOrigin.includes('*') ? true : env.corsOrigin,
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(metricsMiddleware);

app.get('/', (_req, res) => res.json({
  name: 'NexOps API',
  version: env.version,
  docs: '/api/health',
}));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

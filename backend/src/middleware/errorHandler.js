'use strict';
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

function notFound(req, _res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}

// Single place where every error becomes an HTTP response, so the API never
// leaks a stack trace and always answers in the same shape.
function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Unexpected error';
  let details = err.details;

  // Translate the PostgreSQL error codes we can act on.
  if (err.code === '23505') { status = 409; message = 'That record already exists'; }
  if (err.code === '23503') { status = 400; message = 'Referenced record does not exist'; }
  if (err.code === '22P02') { status = 400; message = 'Malformed identifier'; }
  if (err.code === 'ECONNREFUSED') { status = 503; message = 'A dependency is unavailable'; }

  const payload = {
    error: { status, message, requestId: req.id },
  };
  if (details) payload.error.details = details;
  if (status >= 500 && env.nodeEnv !== 'production') payload.error.stack = err.stack;

  if (status >= 500) logger.error({ err, requestId: req.id }, 'unhandled_error');
  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };

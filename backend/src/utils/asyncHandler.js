'use strict';
// Wraps async route handlers so rejected promises reach the error middleware
// instead of hanging the request.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

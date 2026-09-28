'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const ROLES = { ADMIN: 'ADMIN', DEVELOPER: 'DEVELOPER', VIEWER: 'VIEWER' };

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, email: user.email },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, issuer: 'nexops' }
  );
}

function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next(ApiError.unauthorized('Sign in to continue'));
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret, { issuer: 'nexops' });
    req.user = { id: payload.sub, username: payload.username, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    next(ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Your session expired. Sign in again.' : 'Invalid token'));
  }
}

// Role gate. ADMIN passes every check; the rest must be listed explicitly.
function authorize(...allowed) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === ROLES.ADMIN || allowed.includes(req.user.role)) return next();
    next(ApiError.forbidden(`Role ${req.user.role} cannot perform this action`));
  };
}

module.exports = { signToken, authenticate, authorize, ROLES };

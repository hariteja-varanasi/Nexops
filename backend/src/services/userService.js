'use strict';
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { signToken } = require('../middleware/auth');
const audit = require('./auditService');

const PUBLIC_FIELDS = 'id, username, email, full_name, role, is_active, last_login_at, created_at';

async function login(username, password) {
  const { rows } = await db.query(
    'SELECT id,username,email,full_name,role,password_hash,is_active FROM users WHERE username = $1 OR email = $1',
    [username]
  );
  const user = rows[0];
  // Compare against a dummy hash when the user is missing so the response time
  // does not reveal whether the username exists.
  const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) throw ApiError.unauthorized('Username or password is incorrect');
  if (!user.is_active) throw ApiError.forbidden('This account is disabled');

  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit.record({ user, action: 'LOGIN', entityType: 'user', entityId: user.id, summary: `${user.username} signed in` });

  return {
    token: signToken(user),
    expiresIn: env.jwtExpiresIn,
    user: { id: user.id, username: user.username, email: user.email, fullName: user.full_name, role: user.role },
  };
}

async function list() {
  const { rows } = await db.query(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY role, username`);
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`User ${id} does not exist`);
  return rows[0];
}

async function create(data, actor) {
  const passwordHash = await bcrypt.hash(data.password, env.bcryptRounds);
  const { rows } = await db.query(
    `INSERT INTO users (username,email,full_name,password_hash,role)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${PUBLIC_FIELDS}`,
    [data.username, data.email, data.fullName, passwordHash, data.role ?? 'VIEWER']
  );
  await audit.record({
    user: actor, action: 'USER_CREATE', entityType: 'user', entityId: rows[0].id,
    summary: `Created user ${data.username} with role ${data.role ?? 'VIEWER'}`,
  });
  return rows[0];
}

async function update(id, data, actor) {
  const sets = [];
  const params = [];
  const map = { email: 'email', fullName: 'full_name', role: 'role', isActive: 'is_active' };
  for (const [key, column] of Object.entries(map)) {
    if (data[key] !== undefined) { params.push(data[key]); sets.push(`${column} = $${params.length}`); }
  }
  if (data.password) {
    params.push(await bcrypt.hash(data.password, env.bcryptRounds));
    sets.push(`password_hash = $${params.length}`);
  }
  if (!sets.length) return getById(id);
  params.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${PUBLIC_FIELDS}`, params);
  if (!rows.length) throw ApiError.notFound(`User ${id} does not exist`);
  await audit.record({ user: actor, action: 'USER_UPDATE', entityType: 'user', entityId: id, summary: `Updated user ${id}` });
  return rows[0];
}

async function remove(id, actor) {
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) throw ApiError.notFound(`User ${id} does not exist`);
  await audit.record({ user: actor, action: 'USER_DELETE', entityType: 'user', entityId: id, summary: `Deleted user ${id}` });
  return true;
}

module.exports = { login, list, getById, create, update, remove };

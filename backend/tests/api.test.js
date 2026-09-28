'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const app = require('../src/app');
const db = require('../src/config/db');
const cache = require('../src/config/redis');

const ADMIN = {
  username: process.env.SEED_ADMIN_USERNAME || 'admin',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
};

let token;
let createdProjectId;

before(async () => {
  await cache.connect();
  const res = await request(app).post('/api/auth/login').send(ADMIN);
  assert.equal(res.status, 200, 'admin must be able to sign in - run `npm run seed` first');
  token = res.body.token;
});

after(async () => {
  if (createdProjectId) await db.query('DELETE FROM projects WHERE id = $1', [createdProjectId]);
  await cache.disconnect();
  await db.pool.end();
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

describe('health and metrics', () => {
  test('GET /api/health reports each dependency', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
    assert.equal(res.body.database, 'UP');
    assert.ok(['UP', 'DOWN'].includes(res.body.redis));
    assert.ok(res.body.version);
  });

  test('GET /api/health/live does not touch dependencies', async () => {
    const res = await request(app).get('/api/health/live');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
  });

  test('GET /api/metrics exposes Prometheus text format', async () => {
    const res = await request(app).get('/api/metrics');
    assert.equal(res.status, 200);
    assert.match(res.text, /nexops_http_requests_total/);
    assert.match(res.text, /nexops_app_info/);
  });
});

describe('authentication', () => {
  test('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: ADMIN.username, password: 'nope' });
    assert.equal(res.status, 401);
  });

  test('rejects an unauthenticated read', async () => {
    const res = await request(app).get('/api/projects');
    assert.equal(res.status, 401);
  });

  test('rejects a malformed token', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', 'Bearer not.a.jwt');
    assert.equal(res.status, 401);
  });

  test('returns the signed-in user', async () => {
    const res = await auth(request(app).get('/api/auth/me'));
    assert.equal(res.status, 200);
    assert.equal(res.body.username, ADMIN.username);
    assert.equal(res.body.password_hash, undefined, 'password hash must never be serialised');
  });
});

describe('dashboard', () => {
  test('returns totals, environment split and recent deployments', async () => {
    const res = await auth(request(app).get('/api/dashboard/stats'));
    assert.equal(res.status, 200);
    assert.ok(res.body.totals.applications >= 0);
    assert.ok(Array.isArray(res.body.applicationsByEnvironment));
    assert.ok(Array.isArray(res.body.recentDeployments));
    assert.ok(res.body.clusterResources.cpu.unit === 'millicores');
  });
});

describe('projects', () => {
  test('lists projects with counts', async () => {
    const res = await auth(request(app).get('/api/projects'));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    if (res.body.length) assert.equal(typeof res.body[0].application_count, 'number');
  });

  test('creates, reads, updates and deletes a project', async () => {
    const created = await auth(request(app).post('/api/projects'))
      .send({ name: 'Test Project ' + Date.now(), description: 'created by the test suite' });
    assert.equal(created.status, 201);
    createdProjectId = created.body.id;

    const read = await auth(request(app).get(`/api/projects/${createdProjectId}`));
    assert.equal(read.status, 200);

    const updated = await auth(request(app).put(`/api/projects/${createdProjectId}`)).send({ status: 'PAUSED' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'PAUSED');

    const removed = await auth(request(app).delete(`/api/projects/${createdProjectId}`));
    assert.equal(removed.status, 204);
    createdProjectId = null;

    const gone = await auth(request(app).get(`/api/projects/${created.body.id}`));
    assert.equal(gone.status, 404);
  });

  test('rejects an invalid payload with field-level detail', async () => {
    const res = await auth(request(app).post('/api/projects')).send({ name: 'x' });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.error.details));
    assert.equal(res.body.error.details[0].field, 'name');
  });
});

describe('applications', () => {
  test('enforces Kubernetes naming rules', async () => {
    const res = await auth(request(app).post('/api/applications'))
      .send({ name: 'Not Valid', projectId: 1, environmentId: 1 });
    assert.equal(res.status, 400);
  });

  test('filters by environment', async () => {
    const res = await auth(request(app).get('/api/applications?environment=prod'));
    assert.equal(res.status, 200);
    for (const app_ of res.body) assert.equal(app_.environment_slug, 'prod');
  });
});

describe('deployments', () => {
  test('exposes the pipeline stage list used by Jenkins', async () => {
    const res = await auth(request(app).get('/api/deployments/pipeline-stages'));
    assert.equal(res.status, 200);
    assert.ok(res.body.stages.includes('Trivy Scan'));
    assert.ok(res.body.stages.includes('Argo CD Sync'));
  });

  test('every deployment carries an ordered stage list', async () => {
    const res = await auth(request(app).get('/api/deployments?limit=5'));
    assert.equal(res.status, 200);
    for (const d of res.body) assert.ok(Array.isArray(d.stages));
  });
});

describe('environments', () => {
  test('reports namespace and utilisation per environment', async () => {
    const res = await auth(request(app).get('/api/environments'));
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    for (const e of res.body) {
      assert.match(e.namespace, /^nexops-/);
      assert.ok(e.cpu_percent >= 0);
    }
  });
});

describe('logs and monitoring', () => {
  test('log responses declare which backend answered', async () => {
    const res = await auth(request(app).get('/api/logs?limit=5'));
    assert.equal(res.status, 200);
    assert.ok(['loki', 'database'].includes(res.body.source));
  });

  test('rejects an unknown log level', async () => {
    const res = await auth(request(app).get('/api/logs?level=SHOUT'));
    assert.equal(res.status, 400);
  });

  test('monitoring overview declares its source', async () => {
    const res = await auth(request(app).get('/api/monitoring/overview'));
    assert.equal(res.status, 200);
    assert.ok(['prometheus', 'database'].includes(res.body.source));
    assert.equal(typeof res.body.prometheusConfigured, 'boolean');
  });
});

describe('errors', () => {
  test('unknown routes return a structured 404', async () => {
    const res = await auth(request(app).get('/api/does-not-exist'));
    assert.equal(res.status, 404);
    assert.ok(res.body.error.requestId);
  });
});

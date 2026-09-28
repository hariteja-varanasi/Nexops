'use strict';
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const env = require('../config/env');
const logger = require('../config/logger');
const migrate = require('./migrate');

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const sha = () => Array.from({ length: 7 }, () => '0123456789abcdef'[rand(0, 15)]).join('');

const PIPELINE = [
  'Checkout', 'Install Dependencies', 'Lint', 'Unit Tests', 'SonarQube Analysis',
  'Docker Build', 'Trivy Scan', 'Push to Docker Hub', 'Update GitOps Manifest', 'Argo CD Sync',
];

function buildStages(finalStatus) {
  // A FAILED deployment fails at one stage; everything after it never ran.
  const failAt = finalStatus === 'FAILED' ? rand(3, PIPELINE.length - 2) : -1;
  return PIPELINE.map((name, i) => {
    let status = 'SUCCESS';
    if (failAt >= 0 && i === failAt) status = 'FAILED';
    else if (failAt >= 0 && i > failAt) status = 'SKIPPED';
    else if (finalStatus === 'RUNNING' && i > 5) status = i === 6 ? 'RUNNING' : 'PENDING';
    return { name, status, durationMs: status === 'SKIPPED' || status === 'PENDING' ? 0 : rand(1500, 42000) };
  });
}

async function seed() {
  await migrate();

  const { rows: existing } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (existing[0].n > 0) {
    logger.info('seed skipped - database already contains data');
    return;
  }
  if (!env.seedEnabled) {
    logger.warn('SEED_ENABLED=false - skipping demo data');
    return;
  }

  const hash = (pw) => bcrypt.hashSync(pw, env.bcryptRounds);
  const adminPw = hash(env.seedAdminPassword);
  const demoPw = hash('demo12345');

  // ---------------- users ----------------
  const users = [
    [env.seedAdminUsername, 'admin@nexops.local', 'Platform Admin', adminPw, 'ADMIN'],
    ['r.kumar', 'r.kumar@nexops.local', 'Ravi Kumar', demoPw, 'DEVELOPER'],
    ['s.iyer', 's.iyer@nexops.local', 'Sneha Iyer', demoPw, 'DEVELOPER'],
    ['a.mehta', 'a.mehta@nexops.local', 'Arjun Mehta', demoPw, 'DEVELOPER'],
    ['p.rao', 'p.rao@nexops.local', 'Priya Rao', demoPw, 'VIEWER'],
  ];
  const userIds = {};
  for (const [username, email, fullName, pw, role] of users) {
    const { rows } = await pool.query(
      `INSERT INTO users (username,email,full_name,password_hash,role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [username, email, fullName, pw, role]
    );
    userIds[username] = rows[0].id;
  }

  // ---------------- environments ----------------
  const envs = [
    ['Development', 'dev', 'nexops-dev', 'Feature branches land here first. Auto-synced on every commit.', 1, 4, 8, false],
    ['Staging', 'staging', 'nexops-staging', 'Release candidates. Mirrors production configuration.', 2, 6, 12, false],
    ['Production', 'prod', 'nexops-prod', 'Live traffic. Argo CD sync requires manual approval.', 3, 8, 16, true],
  ];
  const envIds = {};
  for (const e of envs) {
    const { rows } = await pool.query(
      `INSERT INTO environments (name,slug,namespace,description,tier,cpu_cores,memory_gb,is_protected)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, e
    );
    envIds[e[1]] = rows[0].id;
  }

  // ---------------- projects ----------------
  const projects = [
    ['Customer Portal', 'customer-portal', 'Self-service account, billing and support portal for end customers.', 'r.kumar', 'ravinadh777/customer-portal', 'prod'],
    ['Payment Platform', 'payment-platform', 'Card and UPI payment capture, settlement and reconciliation.', 's.iyer', 'ravinadh777/payment-platform', 'prod'],
    ['Notification Service', 'notification-service', 'Email, SMS and push fan-out with retry and dead-letter handling.', 'a.mehta', 'ravinadh777/notification-service', 'staging'],
    ['Employee Portal', 'employee-portal', 'Internal HR, leave and asset management for staff.', 'r.kumar', 'ravinadh777/employee-portal', 'staging'],
    ['DevOps Demo', 'devops-demo', 'The NexOps reference stack students deploy end to end.', 'admin', 'ravinadh777/e2edevopsproject', 'dev'],
  ];
  const projIds = {};
  for (const [name, slug, description, owner, repo, envSlug] of projects) {
    const { rows } = await pool.query(
      `INSERT INTO projects (name,slug,description,owner_id,repository,environment_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [name, slug, description, userIds[owner] || userIds[env.seedAdminUsername],
       `https://github.com/${repo}.git`, envIds[envSlug]]
    );
    projIds[slug] = rows[0].id;
  }

  // ---------------- applications ----------------
  const apps = [
    ['frontend', 'customer-portal', 'prod', 'v2.1.0', 'RUNNING', 'HEALTHY', 'JavaScript', 3],
    ['backend', 'customer-portal', 'prod', 'v1.4.2', 'RUNNING', 'HEALTHY', 'Node.js', 3],
    ['payment-service', 'payment-platform', 'staging', 'v1.8.1', 'RUNNING', 'HEALTHY', 'Node.js', 2],
    ['settlement-worker', 'payment-platform', 'staging', 'v0.9.4', 'RUNNING', 'DEGRADED', 'Node.js', 2],
    ['notification-service', 'notification-service', 'staging', 'v1.2.0', 'FAILED', 'UNHEALTHY', 'Node.js', 0],
    ['employee-api', 'employee-portal', 'dev', 'v0.7.3', 'RUNNING', 'HEALTHY', 'Node.js', 1],
    ['nexops-frontend', 'devops-demo', 'dev', 'v1.0.0', 'RUNNING', 'HEALTHY', 'React', 2],
    ['nexops-backend', 'devops-demo', 'dev', 'v1.0.0', 'RUNNING', 'HEALTHY', 'Node.js', 2],
  ];
  const appIds = {};
  for (const [name, projSlug, envSlug, version, status, health, language, pods] of apps) {
    const ns = envs.find((e) => e[1] === envSlug)[2];
    const { rows } = await pool.query(
      `INSERT INTO applications
        (project_id,environment_id,name,description,version,repository,language,
         image_repository,image_tag,k8s_namespace,k8s_deployment,k8s_service,
         replicas,pod_count,cpu_millicores,memory_mb,health,status,git_commit,last_deployed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               now() - ($20 || ' hours')::interval)
       RETURNING id`,
      [projIds[projSlug], envIds[envSlug], name,
       `${name} service for the ${projSlug.replace(/-/g, ' ')} project.`,
       version, `https://github.com/ravinadh777/${projSlug}.git`, language,
       `docker.io/ravinadh777/${name}`, version.replace(/^v/, ''), ns,
       name, `${name}-svc`, pods || 1, pods, rand(80, 600), rand(128, 1024),
       health, status, sha(), rand(1, 120)]
    );
    appIds[`${name}@${envSlug}`] = rows[0].id;
  }

  // ---------------- deployments ----------------
  const appKeys = Object.keys(appIds);
  const statuses = ['SUCCESS', 'SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK', 'RUNNING'];
  let build = 1040;
  for (let i = 0; i < 42; i += 1) {
    const key = pick(appKeys);
    const [appName, envSlug] = key.split('@');
    const status = i < 2 ? 'RUNNING' : pick(statuses);
    const duration = status === 'RUNNING' ? null : rand(95, 480);
    const hoursAgo = 240 - i * 5;
    build += 1;
    await pool.query(
      `INSERT INTO deployments
        (application_id,environment_id,triggered_by,version,git_commit,git_branch,build_number,
         image_tag,strategy,status,stages,notes,started_at,completed_at,duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,
               now() - ($13 || ' hours')::interval,
               CASE WHEN $14::int IS NULL THEN NULL
                    ELSE now() - ($13 || ' hours')::interval + ($14 || ' seconds')::interval END,
               $14)`,
      [appIds[key], envIds[envSlug], userIds[pick(['r.kumar', 's.iyer', 'a.mehta', 'admin'])],
       `v1.${rand(0, 9)}.${rand(0, 9)}`, sha(), pick(['main', 'main', 'main', 'release/1.4', 'feature/cache']),
       build, `1.${rand(0, 9)}.${rand(0, 9)}`, pick(['ROLLING', 'ROLLING', 'ROLLING', 'BLUE_GREEN', 'CANARY']),
       status, JSON.stringify(buildStages(status)),
       status === 'FAILED' ? 'Pipeline stopped at the failing stage. See Jenkins console output.' : null,
       hoursAgo, duration]
    );
  }

  // ---------------- incidents ----------------
  const incidents = [
    ['INC-1001', 'notification-service pods crash-looping after config change', 'CRITICAL', 'OPEN',
     'notification-service@staging', 'a.mehta',
     'readinessProbe on /api/health returns 503. Suspect a missing SMTP_HOST environment variable in the staging ConfigMap.'],
    ['INC-1002', 'Settlement worker lagging behind the payment queue', 'HIGH', 'INVESTIGATING',
     'settlement-worker@staging', 's.iyer',
     'Queue depth grows faster than the worker drains it. Considering an HPA on queue length.'],
    ['INC-1003', 'Elevated p95 latency on the customer portal API', 'MEDIUM', 'INVESTIGATING',
     'backend@prod', 'r.kumar',
     'p95 moved from 180ms to 640ms after the v1.4.2 rollout. Redis cache hit rate dropped at the same time.'],
    ['INC-1004', 'Trivy flagged a HIGH CVE in the frontend base image', 'HIGH', 'RESOLVED',
     'frontend@prod', 'r.kumar',
     'Base image moved from node:20-alpine to node:22-alpine. Rescanned clean.'],
    ['INC-1005', 'Argo CD showed OutOfSync for two hours after a manual kubectl edit', 'LOW', 'RESOLVED',
     'nexops-backend@dev', 'admin',
     'Someone edited the Deployment directly. Argo CD self-heal reverted it. Direct kubectl edits are now blocked by RBAC.'],
    ['INC-1006', 'PostgreSQL PVC reached 85% capacity', 'MEDIUM', 'OPEN',
     'backend@prod', 's.iyer',
     'audit_logs is the largest table. Adding a 90-day retention job.'],
  ];
  for (const [ref, title, severity, status, appKey, assignee, description] of incidents) {
    const envSlug = appKey.split('@')[1];
    await pool.query(
      `INSERT INTO incidents
        (reference,title,description,severity,status,application_id,environment_id,
         assigned_to,created_by,created_at,resolved_at)
       VALUES ($1,$2,$3,$4::varchar,$5::varchar,$6,$7,$8,$9,now() - ($10 || ' hours')::interval,
               CASE WHEN $5::varchar = 'RESOLVED' THEN now() - ($11 || ' hours')::interval ELSE NULL END)`,
      [ref, title, description, severity, status, appIds[appKey], envIds[envSlug],
       userIds[assignee], userIds['admin'] || userIds[env.seedAdminUsername], rand(2, 96), rand(1, 2)]
    );
  }

  // ---------------- application logs ----------------
  const logLines = [
    ['INFO', 'Server listening on port 4000'],
    ['INFO', 'Connected to PostgreSQL pool (max=10)'],
    ['INFO', 'redis connected'],
    ['INFO', 'GET /api/projects 200 in 12ms'],
    ['INFO', 'GET /api/dashboard/stats 200 in 4ms (cache hit)'],
    ['DEBUG', 'Cache miss for key dashboard:stats - querying PostgreSQL'],
    ['WARN', 'Slow query detected: SELECT ... FROM deployments ORDER BY started_at DESC (412ms)'],
    ['WARN', 'Redis reconnect attempt 2'],
    ['ERROR', 'readinessProbe failed: dependency SMTP_HOST is not configured'],
    ['ERROR', 'Unhandled rejection in notification dispatcher: ECONNREFUSED smtp:587'],
    ['INFO', 'Rolling update complete: 2/2 pods ready'],
    ['INFO', 'Argo CD sync finished: status=Synced health=Healthy'],
  ];
  for (let i = 0; i < 400; i += 1) {
    const key = pick(appKeys);
    const [appName, envSlug] = key.split('@');
    const ns = envs.find((e) => e[1] === envSlug)[2];
    const [level, message] = pick(logLines);
    await pool.query(
      `INSERT INTO application_logs (ts,namespace,pod,container,app,level,message)
       VALUES (now() - ($1 || ' minutes')::interval,$2,$3,$4,$5,$6,$7)`,
      [i * 3 + rand(0, 2), ns, `${appName}-${sha()}-${sha().slice(0, 5)}`, appName, appName, level, message]
    );
  }

  // ---------------- metric samples (last 24h, 5-minute resolution) ----------------
  const metrics = [
    ['cpu_usage_percent', 18, 74], ['memory_usage_percent', 32, 81],
    ['disk_usage_percent', 41, 58], ['http_requests_per_min', 240, 1900],
    ['http_errors_per_min', 0, 24], ['response_time_ms', 68, 420],
  ];
  const values = [];
  for (const [metric, lo, hi] of metrics) {
    let current = rand(lo, hi);
    for (let i = 288; i >= 0; i -= 1) {
      current = Math.max(lo, Math.min(hi, current + rand(-Math.round((hi - lo) / 9), Math.round((hi - lo) / 9))));
      values.push(`(now() - interval '${i * 5} minutes', '${metric}', 'all', ${current})`);
    }
  }
  await pool.query(
    `INSERT INTO metric_samples (ts, metric, environment, value) VALUES ${values.join(',')}`
  );

  // ---------------- audit trail ----------------
  await pool.query(
    `INSERT INTO audit_logs (user_id,username,action,entity_type,entity_id,summary)
     VALUES ($1,$2,'SEED','system','bootstrap','Demo dataset loaded')`,
    [userIds[env.seedAdminUsername], env.seedAdminUsername]
  );

  logger.info({
    users: users.length, environments: envs.length, projects: projects.length,
    applications: apps.length, deployments: 42, incidents: incidents.length,
  }, 'demo data seeded');
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { logger.error({ err }, 'seed failed'); process.exit(1); });
}

module.exports = seed;

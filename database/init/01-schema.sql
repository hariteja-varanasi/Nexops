-- =====================================================================
-- NexOps schema (migration 001)
-- Idempotent: safe to run on every container start.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       VARCHAR(50)  NOT NULL UNIQUE,
  email          VARCHAR(255) NOT NULL UNIQUE,
  full_name      VARCHAR(120) NOT NULL,
  password_hash  TEXT         NOT NULL,
  role           VARCHAR(20)  NOT NULL DEFAULT 'VIEWER'
                 CHECK (role IN ('ADMIN','DEVELOPER','VIEWER')),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- environments ----------
CREATE TABLE IF NOT EXISTS environments (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(50)  NOT NULL UNIQUE,
  slug         VARCHAR(50)  NOT NULL UNIQUE,
  namespace    VARCHAR(80)  NOT NULL UNIQUE,
  description  TEXT,
  cluster      VARCHAR(80)  NOT NULL DEFAULT 'nexops-kind',
  tier         SMALLINT     NOT NULL DEFAULT 1,
  cpu_cores    NUMERIC(6,2) NOT NULL DEFAULT 2,
  memory_gb    NUMERIC(6,2) NOT NULL DEFAULT 4,
  is_protected BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- projects ----------
CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,
  slug        VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  repository  VARCHAR(255),
  environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- applications ----------
CREATE TABLE IF NOT EXISTS applications (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id  INTEGER NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  name            VARCHAR(120) NOT NULL,
  description     TEXT,
  version         VARCHAR(40)  NOT NULL DEFAULT 'v0.1.0',
  repository      VARCHAR(255),
  language        VARCHAR(40),
  image_repository VARCHAR(255),
  image_tag       VARCHAR(80),
  k8s_namespace   VARCHAR(80),
  k8s_deployment  VARCHAR(120),
  k8s_service     VARCHAR(120),
  replicas        SMALLINT NOT NULL DEFAULT 1 CHECK (replicas >= 0),
  pod_count       SMALLINT NOT NULL DEFAULT 1 CHECK (pod_count >= 0),
  cpu_millicores  INTEGER  NOT NULL DEFAULT 100,
  memory_mb       INTEGER  NOT NULL DEFAULT 256,
  health          VARCHAR(20) NOT NULL DEFAULT 'HEALTHY'
                  CHECK (health IN ('HEALTHY','DEGRADED','UNHEALTHY','UNKNOWN')),
  status          VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
                  CHECK (status IN ('RUNNING','STOPPED','FAILED','PENDING','DEPLOYING')),
  git_commit      VARCHAR(40),
  last_deployed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, environment_id)
);

-- ---------- deployments ----------
CREATE TABLE IF NOT EXISTS deployments (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  triggered_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version        VARCHAR(40)  NOT NULL,
  git_commit     VARCHAR(40),
  git_branch     VARCHAR(120) NOT NULL DEFAULT 'main',
  build_number   INTEGER,
  image_tag      VARCHAR(120),
  strategy       VARCHAR(20) NOT NULL DEFAULT 'ROLLING'
                 CHECK (strategy IN ('ROLLING','RECREATE','BLUE_GREEN','CANARY')),
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','RUNNING','SUCCESS','FAILED','ROLLED_BACK')),
  -- Ordered CI/CD stage results, e.g.
  -- [{"name":"Trivy Scan","status":"SUCCESS","durationMs":18000}]
  stages         JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes          TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  duration_seconds INTEGER
);

-- ---------- incidents ----------
CREATE TABLE IF NOT EXISTS incidents (
  id             SERIAL PRIMARY KEY,
  reference      VARCHAR(20) NOT NULL UNIQUE,
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  severity       VARCHAR(10) NOT NULL DEFAULT 'LOW'
                 CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status         VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED')),
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL,
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

-- ---------- audit_logs ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(50),
  action      VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   VARCHAR(50),
  summary     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- application_logs ----------
-- Log lines NexOps itself records. When LOKI_URL is configured the Logs API
-- queries Loki instead and reports source="loki".
CREATE TABLE IF NOT EXISTS application_logs (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  namespace   VARCHAR(80)  NOT NULL,
  pod         VARCHAR(140) NOT NULL,
  container   VARCHAR(80)  NOT NULL,
  app         VARCHAR(120) NOT NULL,
  level       VARCHAR(10)  NOT NULL DEFAULT 'INFO'
              CHECK (level IN ('DEBUG','INFO','WARN','ERROR','FATAL')),
  message     TEXT NOT NULL
);

-- ---------- metric_samples ----------
-- Local time-series fallback used by the Monitoring page when Prometheus is
-- not reachable. Prometheus remains the source of truth when PROMETHEUS_URL is set.
CREATE TABLE IF NOT EXISTS metric_samples (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  metric      VARCHAR(60) NOT NULL,
  environment VARCHAR(50),
  value       NUMERIC(12,3) NOT NULL
);

-- ---------- indexes ----------
CREATE INDEX IF NOT EXISTS idx_projects_status        ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_owner         ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_apps_project           ON applications(project_id);
CREATE INDEX IF NOT EXISTS idx_apps_environment       ON applications(environment_id);
CREATE INDEX IF NOT EXISTS idx_apps_status            ON applications(status);
CREATE INDEX IF NOT EXISTS idx_deploy_app             ON deployments(application_id);
CREATE INDEX IF NOT EXISTS idx_deploy_started         ON deployments(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_status          ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_incidents_status       ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity     ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_audit_created          ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_ts                ON application_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_app_level         ON application_logs(app, level);
CREATE INDEX IF NOT EXISTS idx_metrics_metric_ts      ON metric_samples(metric, ts DESC);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','projects','applications','incidents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;

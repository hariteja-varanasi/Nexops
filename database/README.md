# Database

PostgreSQL 16. One schema, applied idempotently.

## What runs when

| Path | When it runs | What it does |
|---|---|---|
| `init/01-schema.sql` | First container start only, by the postgres image | Creates the schema on a brand-new volume |
| `backend/src/db/migrate.js` | Every backend start and in CI | Applies `schema.sql` again — safe, everything is `IF NOT EXISTS` |
| `backend/src/db/seed.js` | Compose `migrate` service, or `npm run seed` | Loads demo data, and skips if any user already exists |

`init/01-schema.sql` is a copy of `backend/src/db/schema.sql`. The backend copy is
the source of truth; refresh this one with:

```bash
cp backend/src/db/schema.sql database/init/01-schema.sql
```

## Tables

```
users ──┬─< projects ──< applications ──┬─< deployments
        │                  │            └─< incidents
        ├─< audit_logs     │
        └─< incidents      └── environments (dev / staging / prod)

application_logs   log lines, read when LOKI_URL is unset
metric_samples     time series, read when PROMETHEUS_URL is unset
schema_migrations  applied migration versions
```

## Commands

```bash
# Shell into the database
docker compose exec postgres psql -U nexops -d nexops

# Row counts
docker compose exec postgres psql -U nexops -d nexops -c "
  SELECT 'projects' t, count(*) FROM projects
  UNION ALL SELECT 'applications', count(*) FROM applications
  UNION ALL SELECT 'deployments', count(*) FROM deployments;"

# Start over
docker compose down -v && docker compose up -d
```

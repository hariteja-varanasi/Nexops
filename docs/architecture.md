# Architecture

## What NexOps is

A web application that manages deployments, and the DevOps pipeline that ships
it. Both halves are real: the application talks to PostgreSQL and Redis and
serves an API; the pipeline builds, scans and deploys that application.

Studying only one half teaches half a lesson. NexOps is deliberately its own
first customer.

## The whole picture

```
 DEVELOPER
     │  git push
     ▼
 GitHub ──────────── webhook ────────────► Jenkins
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                 npm ci                  SonarQube                  docker build
                 npm test                quality gate                    │
                    │                         │                       Trivy scan
                    └─────────────────────────┼─────────────────────────┘
                                              │
                                              ▼
                                      Docker Hub  (nexops-backend, nexops-frontend)
                                              │
                                              │ Jenkins commits the new tag
                                              ▼
                                    gitops/<env>/values.yaml  in GitHub
                                              │
                                              │ Argo CD polls Git
                                              ▼
 ┌────────────────────────── kind cluster, one EC2 host ──────────────────────────┐
 │                                                                                │
 │  ingress-nginx  :80/:443 on the host                                           │
 │        │                                                                       │
 │        ├── /      ──► frontend  (NGINX serving the React bundle)               │
 │        └── /api   ──► backend   (Node.js + Express)                            │
 │                          │                                                     │
 │                          ├──► PostgreSQL   StatefulSet + PVC                   │
 │                          └──► Redis        Deployment, no volume               │
 │                                                                                │
 │  namespaces: nexops-dev · nexops-staging · nexops-prod                         │
 │                                                                                │
 │  monitoring/   Prometheus ◄── scrapes /api/metrics ──┐                         │
 │                Grafana ──► reads Prometheus and Loki │                         │
 │  logging/      Promtail (DaemonSet) ──► Loki ────────┘                         │
 │  argocd/       Argo CD ──► reconciles every namespace                          │
 └────────────────────────────────────────────────────────────────────────────────┘
```

## Why it is shaped this way

**Jenkins never runs `kubectl apply`.** Its last real step is a commit to
`gitops/<env>/values.yaml`. Argo CD is what changes the cluster. That means the
running state is always described by a file in Git — you can answer "what is
deployed and who changed it" with `git log`, and roll back with `git revert`.

**Three namespaces, one cluster.** A separate cluster per environment would be
correct at work and impossible on one EC2 box. Namespaces give real separation
of Secrets, quotas and NetworkPolicies at a fraction of the cost.

**The frontend proxies `/api`.** The browser only ever talks to one origin, so
there is no CORS anywhere in the stack. The Ingress also routes `/api` directly,
so API traffic does not pass through NGINX twice in the cluster.

**PostgreSQL is a StatefulSet, Redis is a Deployment.** The database needs a
stable identity and its own volume that survives rescheduling. The cache does
not — losing it costs one slow request per key, which is exactly why it gets
the simpler resource type.

## Request path

```
browser  →  EC2 :80  →  kind control-plane (hostPort)  →  ingress-nginx
              → Service frontend  → NGINX pod → index.html + assets
              → Service backend   → Express  → Redis (cache hit?)
                                             → PostgreSQL (on a miss)
```

Redis sits in front of the dashboard endpoint, which is by far the most
requested. `GET /api/dashboard/stats` returns `cached: true` on a hit, and every
write path calls `cache.invalidate('nexops:dashboard')`, so the cached view is
never more than one write behind.

## Data model

```
users ──┬─< projects ──< applications ──┬─< deployments
        │                    │          └─< incidents
        ├─< audit_logs       │
        └─< incidents        └── environments (dev / staging / prod)

application_logs    read when LOKI_URL is unset
metric_samples      read when PROMETHEUS_URL is unset
schema_migrations   applied versions
```

`deployments.stages` is a JSONB array holding the result of each pipeline stage:

```json
[{"name": "Trivy Scan", "status": "SUCCESS", "durationMs": 18402}]
```

Jenkins writes to it stage by stage via `PUT /api/deployments/:id/stage`, which
is how the Deployments page shows the same pipeline Jenkins just ran.

## Observability, and being honest about it

The Monitoring and Logs APIs each have two backends:

| Surface | `PROMETHEUS_URL` / `LOKI_URL` set | unset |
|---|---|---|
| Monitoring | PromQL against Prometheus, `source: "prometheus"` | `metric_samples` table, `source: "database"` |
| Logs | LogQL against Loki, `source: "loki"` | `application_logs` table, `source: "database"` |

Every response states which backend answered, and the UI shows a banner when it
is reading from the database. Nothing is presented as live cluster data when it
is not.

## Where each component runs

| Component | Runs | Why there |
|---|---|---|
| kind cluster | Docker containers on EC2 | 3 "nodes" on one machine |
| ingress-nginx | in cluster, hostPort 80/443 | kind has no cloud LoadBalancer |
| NexOps | in cluster, 3 namespaces | the thing being deployed |
| Argo CD | in cluster, `argocd` ns | needs cluster API access to reconcile |
| Prometheus/Grafana/Loki | in cluster | scraping and log collection are in-cluster jobs |
| Jenkins, SonarQube | plain Docker on EC2 | CI that lives in the cluster it deploys to cannot recover that cluster |

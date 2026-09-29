# NexOps

An end-to-end DevOps training platform. A real web application, plus the
complete pipeline that builds, scans, ships and watches it — all running on one
machine.

```
Code → GitHub → Jenkins → SonarQube → Trivy → Docker → Docker Hub
     → Argo CD → kind Kubernetes → Prometheus → Grafana → Loki → NexOps UI
```

NexOps is deliberately its own first customer: the application you deploy is the
application that shows you the deployment.

---

## Quick start

```bash
git clone https://github.com/hariteja-varanasi/Nexops.git nexops
cd nexops

./scripts/setup-ec2.sh     # installs Docker, kubectl, kind, Helm, Trivy, Argo CD CLI
newgrp docker              # picks up the docker group in this shell
./setup.sh                 # builds, deploys and verifies everything
```

Then open the URL it prints and sign in with `admin` / `admin123`.

| Command | What you get | Time |
|---|---|---|
| `./setup.sh` | App on kind: frontend, API, PostgreSQL, Redis, Ingress | ~6 min |
| `./setup.sh --full` | The above plus Argo CD, Prometheus, Grafana, Loki | ~18 min |
| `./setup.sh --everything` | The above plus Jenkins and SonarQube | ~25 min |
| `./setup.sh --clean` | Tear the cluster down | ~30 sec |

Just want to see the application? `docker compose up -d --build`, then
`http://localhost`. No Kubernetes involved.

---

## What NexOps does

A deployment control plane. Eleven pages, all backed by a real API and database:

| Page | Shows |
|---|---|
| Dashboard | The live delivery chain, totals, deployment outcomes, cluster resources |
| Projects | Full CRUD over projects, owners, repositories |
| Applications | Every workload, its image, pods, namespace and commit |
| Application detail | Deploy, scale, restart and roll back, each printing its `kubectl` equivalent |
| Deployments | Every pipeline run, with per-stage results |
| Deployment detail | The ten pipeline stages and what each one did |
| Environments | Namespaces, capacity, health per environment |
| Infrastructure | Every tool in the chain and which machine it runs on |
| Monitoring | Live PromQL, or stored samples with a banner saying so |
| Logs | Live LogQL against Loki, with the equivalent Grafana query shown |
| Incidents | Severity, assignment, open → investigating → resolved |

---

## Learning path

Eight levels. Each builds on the last, and each has an exercise in its doc.

### Level 1 — Application development
React, Node.js, Express, REST, PostgreSQL, Redis, JWT auth.
`frontend/` · `backend/` · `database/`

Start here: `docker compose up -d`, then read `backend/src/routes/index.js`.
Every endpoint is one line, pointing at a controller, pointing at a service.

### Level 2 — Git
Branching, commits, pull requests, and the commit as a deployment trigger.
The whole repository is the exercise.

### Level 3 — Docker
Multi-stage builds, layer caching, non-root users, Compose.
→ **[docs/docker.md](docs/docker.md)**

### Level 4 — Kubernetes
Pods, Deployments, StatefulSets, Services, ConfigMaps, Secrets, Ingress, PVCs,
the three probes, resources, HPA.
→ **[docs/kubernetes.md](docs/kubernetes.md)**

### Level 5 — Continuous integration
Jenkins pipelines, testing in CI, SonarQube quality gates, Trivy scanning.
→ **[docs/jenkins.md](docs/jenkins.md)**

### Level 6 — Container registry
Tagging strategy, pushing, pulling, why production pins a tag.
`scripts/push-images.sh` · the Push stage in `Jenkinsfile`

### Level 7 — Continuous delivery and GitOps
Argo CD, desired state in Git, sync policies, self-heal, promotion, rollback.
→ **[docs/argocd.md](docs/argocd.md)**

### Level 8 — Observability
Prometheus, PromQL, Grafana, Loki, LogQL, alert rules, cardinality.
→ **[docs/monitoring.md](docs/monitoring.md)**

---

## The demonstration

The point of the whole project: a one-line change reaching a running cluster
without anyone touching the cluster.

```bash
# 1. Change something visible
vim frontend/src/pages/Login.jsx
#    "One console for the whole delivery chain"
# →  "NexOps — one console for the whole delivery chain"

git add . && git commit -m "Update dashboard title" && git push
```

**2. Jenkins starts on its own** (`http://<ip>:8080`)

```
Checkout ✓  Install ✓  Lint ✓  Tests ✓  SonarQube ✓  Quality Gate ✓
Docker Build ✓  Trivy ✓  Push to Docker Hub ✓  Update GitOps Manifest ✓
```

**3. The handover to CD**

```bash
git log --oneline -1 -- gitops/dev/values.yaml
# a1b2c3d deploy(dev): nexops 1.0.42 from 9f8e7d6 [skip ci]
```

Jenkins never ran `kubectl`. It wrote a file.

**4. Argo CD notices**

```
nexops-dev   OutOfSync → Syncing → Synced   Healthy
```

**5. Kubernetes rolls**

```bash
kubectl -n nexops-dev get pods -w
kubectl -n nexops-dev get deploy nexops-backend \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

**6. Open the browser.** The change is live.

### Three more, each one script

```bash
./scripts/demo-scaling.sh    # 1 → 2 → 3 pods, across both kind workers
./scripts/demo-failure.sh    # break it, investigate through Grafana and Loki, fix
./scripts/demo-rollback.sh   # v1.1 → v1.2 → broken → rollback, both ways
```

`demo-failure.sh` is the most instructive. It breaks one environment variable
and walks through how each layer reports it — and shows why the application
never actually went down.

---

## Repository layout

```
nexops/
├── frontend/            React 18 + Vite + Router + Recharts, 14 pages
├── backend/             Node.js + Express, 40+ routes, 20 tests
├── database/            PostgreSQL schema, 9 tables
│
├── kubernetes/          base manifests + dev/staging/prod kustomize overlays
├── helm/nexops/         the chart Argo CD actually deploys
├── argocd/              install script, Applications, AppProject
├── gitops/              desired state per environment — Jenkins writes here
│
├── monitoring/          Prometheus + Grafana values, 5 dashboards
├── logging/             Loki + Promtail values
├── terraform/           the EC2 instance everything runs on
├── jenkins/             Jenkins + SonarQube, configured as code
├── scripts/             setup, cluster, images, and the three demos
├── docs/                nine guides
│
├── docker-compose.yml   local stack, no Kubernetes
├── kind-config.yaml     1 control-plane + 2 workers
├── Jenkinsfile          the 10-stage pipeline
├── setup.sh             one command
└── .env.example
```

---

## Documentation

| Guide | Covers |
|---|---|
| [architecture.md](docs/architecture.md) | How the pieces fit and why they are shaped that way |
| [installation.md](docs/installation.md) | Three install routes with expected output |
| [docker.md](docs/docker.md) | Multi-stage builds, caching, non-root |
| [kubernetes.md](docs/kubernetes.md) | Every object used, and the three probes |
| [jenkins.md](docs/jenkins.md) | The pipeline, credentials, the CI/CD handover |
| [argocd.md](docs/argocd.md) | GitOps, sync policies, promotion, rollback |
| [monitoring.md](docs/monitoring.md) | Prometheus, PromQL, Grafana, Loki, LogQL |
| [security.md](docs/security.md) | Secrets, hardening, and an honest list of trade-offs |
| [troubleshooting.md](docs/troubleshooting.md) | Symptom → cause → fix |

---

## Requirements

| | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| Memory | 8 GiB | 16 GiB |
| Disk | 50 GiB | 100 GiB |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 |
| EC2 | `t3.large` | `t3.xlarge` |

SonarQube alone wants ~2 GiB and will be OOM-killed below `t3.large`.

---

## Two things worth knowing

**Jenkins never deploys.** Its last action is a commit to `gitops/<env>/values.yaml`.
Argo CD is what changes the cluster. So `git log` answers "what is deployed and
who changed it", and `git revert` is a rollback.

**The Monitoring and Logs pages tell you where their data came from.** With
`PROMETHEUS_URL` and `LOKI_URL` set they run real PromQL and LogQL and report
`source: "prometheus"` / `"loki"`. Without them they read from PostgreSQL,
report `source: "database"`, and the UI shows a banner saying so. Nothing is
presented as live cluster data when it is not.

---

## Security

**This repository is public, so every placeholder in it is a published value,
not a weak one.** Install the commit-time guard before you start:

```bash
git config core.hooksPath .githooks
```

The backend enforces the same thing at runtime: it refuses to start in
production with a placeholder `JWT_SECRET`, a secret shorter than 32 characters,
or the documented `admin123` password while seeding is on.

No credentials are committed. `setup.sh` generates `JWT_SECRET` and
`POSTGRES_PASSWORD` with `openssl rand` on first run. `.env`, `*.pem`,
`terraform.tfvars` and `kubeconfig` are all git-ignored.

The seeded `admin`/`admin123` login exists so the demo works immediately.
**Change `SEED_ADMIN_PASSWORD` before putting this anywhere shared.**

See [docs/security.md](docs/security.md), including an honest list of the
trade-offs made for teaching convenience.

---

## License

MIT

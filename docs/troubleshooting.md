# Troubleshooting

## Start here

```bash
# 1. Is the cluster up?
kubectl get nodes
kubectl cluster-info

# 2. What is not Running?
kubectl get pods -A | grep -v Running | grep -v Completed

# 3. Why?
kubectl -n <namespace> describe pod <pod>
kubectl -n <namespace> get events --sort-by=.lastTimestamp | tail -20

# 4. What did it say before it died?
kubectl -n <namespace> logs <pod> --previous
```

`describe pod` before `logs`. A pod that never started has no logs, and its
Events section explains why.

---

## Setup

**`./setup.sh` fails at "cannot reach the Docker daemon"**

You were added to the `docker` group but this shell predates it.

```bash
newgrp docker      # or log out and back in
docker info        # should now work
```

**`./setup.sh` fails at the Helm install with a timeout**

Usually the backend's init container cannot reach PostgreSQL.

```bash
kubectl -n nexops-dev get pods
kubectl -n nexops-dev logs <backend-pod> -c migrate
kubectl -n nexops-dev get pod nexops-postgres-0     # must be 1/1 Running
```

If `nexops-postgres-0` is `Pending`, the node is out of memory or there is no
StorageClass — check `kubectl describe pod nexops-postgres-0`.

**Pods stuck in `ImagePullBackOff`**

The single most common kind problem. Kind nodes have their own container
runtime and cannot see the host's images.

```bash
./scripts/load-images.sh
kubectl -n nexops-dev rollout restart deployment/nexops-backend
```

If it persists, confirm the image name matches exactly:

```bash
docker images | grep nexops
kubectl -n nexops-dev get deploy nexops-backend -o jsonpath='{.spec.template.spec.containers[0].image}'
```

A registry prefix like `docker.io/library/nexops-backend:local` will never match
a side-loaded image — the name must be bare.

**kind cluster will not create**

```bash
# Usually inotify limits
sudo sysctl -w fs.inotify.max_user_instances=512
sudo sysctl -w fs.inotify.max_user_watches=524288

# Or leftover state from a failed attempt
kind delete cluster --name nexops
docker ps -a | grep nexops    # remove any orphaned node containers
```

---

## Application

**`http://nexops-dev.local` does not resolve**

```bash
grep nexops /etc/hosts
echo "127.0.0.1 nexops-dev.local" | sudo tee -a /etc/hosts

# Or skip it entirely — there is a host-less Ingress rule:
curl http://$(hostname -I | awk '{print $1}')
```

**Ingress returns 503**

The Service has no ready endpoints.

```bash
kubectl -n nexops-dev get endpoints
# If empty, the pods are not passing readiness:
kubectl -n nexops-dev describe pod -l app.kubernetes.io/component=backend | grep -A5 Readiness
```

**Login fails with "Username or password is incorrect"**

The demo user is created by the seed, which only runs on an empty database.

```bash
kubectl -n nexops-dev logs -l app.kubernetes.io/component=backend -c migrate
# "seed skipped - database already contains data" means the user exists but the
# password differs from what you are typing. Check the Secret:
kubectl -n nexops-dev get secret nexops-secrets -o jsonpath='{.data.SEED_ADMIN_PASSWORD}' | base64 -d
```

**API returns 500 on every request**

```bash
kubectl -n nexops-dev exec deploy/nexops-backend -c backend -- \
  wget -qO- http://127.0.0.1:4000/api/health
# database: "DOWN" → PostgreSQL problem
# redis: "DOWN"    → harmless; the app degrades to no caching
```

Redis being down is never the cause of a 500. It is designed to degrade.

**Dashboard numbers are stale**

Redis caches the dashboard for 30 seconds, and writes invalidate it.

```bash
kubectl -n nexops-dev exec deploy/nexops-redis -- redis-cli KEYS 'nexops:*'
kubectl -n nexops-dev exec deploy/nexops-redis -- redis-cli FLUSHALL
```

---

## CI/CD

**Jenkins build fails at `docker: not found`**

```bash
cd jenkins && docker compose build jenkins && docker compose up -d
docker compose exec jenkins docker --version
```

**Quality Gate hangs for the full 10 minutes**

SonarQube cannot call Jenkins back. Add the webhook in SonarQube →
Administration → Configuration → Webhooks:

```
URL: http://jenkins:8080/sonarqube-webhook/
```

**Trivy fails the build**

It is doing its job. `--ignore-unfixed` is set, so everything reported **has a
fix available**.

```bash
trivy image nexops-backend:local --severity HIGH,CRITICAL --ignore-unfixed
```

Fix it by moving to a newer base image (`node:22-alpine` → a fresher digest) or
bumping the flagged dependency. Suppressing the finding is the wrong answer; if
you genuinely must, use a `.trivyignore` with an expiry date and a reason.

**GitOps push rejected**

```bash
# The PAT needs `repo` scope and must not be expired.
# Test it:
git ls-remote https://<user>:<token>@github.com/hariteja-varanasi/Nexops.git
```

**Argo CD shows Synced but the old version is still running**

```bash
kubectl -n nexops-dev get deploy nexops-backend -o jsonpath='{.spec.template.spec.containers[0].image}'
grep tag: gitops/dev/values.yaml
```

If they match, Argo CD did its job and the pods have not rolled yet:
`kubectl -n nexops-dev rollout status deployment/nexops-backend`.

If the tag is `latest`, this is exactly why production pins an explicit tag —
`latest` gives Argo CD nothing to detect as a change.

---

## Observability

**Prometheus has no NexOps target**

```bash
kubectl -n nexops-dev get pod -l app.kubernetes.io/component=backend -o yaml | grep -A3 'prometheus.io'
# All three annotations must be present: scrape, port, path.
```

**Grafana dashboards are empty**

1. Check the time range — default is Last 6 hours, and a new cluster has little.
2. Check the data source dropdown at the top of the dashboard.
3. Confirm Prometheus has data at all: port-forward 9090 and run `up`.

**Loki returns nothing**

```bash
kubectl -n logging get pods          # promtail count must equal node count
kubectl -n logging logs -l app.kubernetes.io/name=promtail --tail=30
```

`too far behind` in the Promtail logs means clock skew. Restart time sync on the
host.

---

## Resources

**Everything is slow, or pods are being OOMKilled**

```bash
free -h
kubectl top nodes
kubectl top pods -A --sort-by=memory
```

The full stack wants 16 GiB. On 8 GiB, drop SonarQube:

```bash
cd jenkins && docker compose stop sonarqube sonar-db
```

and set `SKIP_SONAR=true` when building.

**Disk full**

```bash
df -h
docker system df
docker system prune -a --volumes     # frees a lot; re-pulls on next build
```

Prometheus and Loki PVCs live inside the kind node containers, so they count
against the host root volume.

---

## Start completely over

```bash
./setup.sh --clean
cd jenkins && docker compose down -v
docker system prune -a --volumes
./setup.sh --everything
```

## Still stuck

Collect this before asking anyone:

```bash
kubectl get nodes -o wide
kubectl get pods -A
kubectl -n nexops-dev describe pod -l app.kubernetes.io/component=backend
kubectl -n nexops-dev logs -l app.kubernetes.io/component=backend --tail=50
docker ps -a
free -h && df -h
```

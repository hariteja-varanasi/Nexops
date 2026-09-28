# Kubernetes

## What is it

A system that keeps a declared state true. You describe what should be running;
Kubernetes makes it so and keeps it that way when things fail.

## Why NexOps uses it

Docker Compose runs containers on one machine and restarts them when they crash.
Kubernetes adds what production needs: rolling updates with no downtime, health
checks that gate traffic, horizontal scaling, self-healing, secret management
and a consistent way to express all of it.

## Objects in this project

| Object | Used for | File |
|---|---|---|
| Namespace | Separating dev/staging/prod | `kubernetes/namespace/namespaces.yaml` |
| Deployment | backend, frontend, redis | `kubernetes/base/*/deployment.yaml` |
| StatefulSet | PostgreSQL | `kubernetes/base/postgres/statefulset.yaml` |
| Service | Stable in-cluster addresses | `kubernetes/base/*/service.yaml` |
| Ingress | HTTP entry from outside | `kubernetes/base/ingress/ingress.yaml` |
| ConfigMap | Non-secret configuration | `kubernetes/base/config/configmap.yaml` |
| Secret | Passwords, JWT key | created imperatively by `setup.sh` |
| PVC | PostgreSQL storage | `volumeClaimTemplates` in the StatefulSet |
| HPA | Autoscaling the backend | `kubernetes/base/backend/hpa.yaml` |
| NetworkPolicy | Restricting pod-to-pod traffic | `kubernetes/base/ingress/networkpolicy.yaml` |

## Deployment vs StatefulSet

Redis is a Deployment. PostgreSQL is a StatefulSet. The difference is identity.

A Deployment's pods are interchangeable: random names, any pod can be replaced
by any other. Fine for a cache — losing it costs one slow request per key.

A StatefulSet gives each pod a stable name (`postgres-0`) and its **own** PVC
that follows it across restarts and rescheduling. Try to run PostgreSQL as a
Deployment with a shared volume and the first rolling update starts a second pod
against the same data directory, which corrupts it.

## The three probes

This is the part most people get wrong, so it is worth being precise:

```yaml
startupProbe:                              # "has it finished booting?"
  httpGet: { path: /api/health/live, port: http }
  failureThreshold: 24                     # up to 2 minutes
readinessProbe:                            # "should it receive traffic?"
  httpGet: { path: /api/health, port: http }
livenessProbe:                             # "is the process wedged?"
  httpGet: { path: /api/health/live, port: http }
```

`/api/health` checks PostgreSQL. `/api/health/live` does not.

That asymmetry is deliberate. Readiness checks dependencies, so a pod that
cannot reach the database is removed from the Service and stops receiving
traffic. Liveness must **not** check dependencies — if it did, a 30-second
database blip would restart every backend pod simultaneously, turning a brief
outage into a thundering herd against a database that is already struggling.

The startup probe exists so liveness can have a short period without also having
a long `initialDelaySeconds`. Slow boot is tolerated; a wedge after boot is
caught in 20 seconds.

## Rolling updates

```yaml
strategy:
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

`maxUnavailable: 0` means Kubernetes never removes a working pod until a
replacement is ready. A broken release stalls instead of causing an outage —
which is exactly what `scripts/demo-rollback.sh` demonstrates.

## Resource requests and limits

```yaml
resources:
  requests: { cpu: 100m, memory: 192Mi }   # used for scheduling
  limits:   { cpu: 600m, memory: 512Mi }   # enforced at runtime
```

Requests decide where a pod is placed. Limits cap it. Exceeding the memory limit
gets the container OOM-killed; exceeding the CPU limit throttles it, which is
slower but not fatal. Omit requests entirely and the scheduler will happily
overcommit a node until everything on it starts failing.

## Secrets

Kubernetes Secrets are **base64-encoded, not encrypted**:

```bash
kubectl -n nexops-dev get secret nexops-secrets -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

That is why `setup.sh` creates the Secret imperatively from generated values and
`kubernetes/base/config/secret.yaml` is labelled a template. For GitOps, encrypt
before committing:

```bash
# Sealed Secrets — only the cluster's controller can decrypt
kubeseal --format yaml < secret.yaml > sealed-secret.yaml   # safe to commit

# or SOPS with age
sops --encrypt --age <public-key> secret.yaml > secret.enc.yaml
```

## Commands

```bash
# What is running
kubectl -n nexops-dev get pods,svc,ingress,pvc
kubectl -n nexops-dev get all

# Why is it not running
kubectl -n nexops-dev describe pod <pod>
kubectl -n nexops-dev get events --sort-by=.lastTimestamp | tail -20

# Logs
kubectl -n nexops-dev logs -l app.kubernetes.io/component=backend -f
kubectl -n nexops-dev logs <pod> --previous        # the crashed container

# Get inside
kubectl -n nexops-dev exec -it deploy/nexops-backend -c backend -- sh
kubectl -n nexops-dev port-forward svc/nexops-backend 4000:4000

# Change things
kubectl -n nexops-dev scale deployment/nexops-backend --replicas=3
kubectl -n nexops-dev rollout restart deployment/nexops-backend
kubectl -n nexops-dev rollout undo deployment/nexops-backend

# Resources
kubectl top nodes
kubectl top pods -A
```

## Exercise

1. `kubectl -n nexops-dev get pods -o wide` — which node is each pod on?
2. Delete a backend pod. Time how long until a replacement is Ready.
   Which controller recreated it?
3. Break readiness: `kubectl -n nexops-dev set env deploy/nexops-backend
   DATABASE_URL=postgresql://wrong@nowhere:5432/x`. Watch `get endpoints` —
   the pod leaves the Service but is not restarted. Explain why liveness did
   not fire.
4. Undo it: `kubectl -n nexops-dev set env deploy/nexops-backend DATABASE_URL-`
5. Prove the NetworkPolicy works (prod only): exec into the frontend pod and
   `nc -zv nexops-postgres 5432`. It should hang.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ImagePullBackOff` on kind | Image not loaded into the nodes | `./scripts/load-images.sh` |
| `ImagePullBackOff` with a local tag | `imagePullPolicy: Always` ignores local images | Set it to `IfNotPresent` |
| Pod stuck `Pending` | No node has room for the requests | `kubectl describe pod` → Events; lower requests |
| `CrashLoopBackOff` | App exits on start | `kubectl logs <pod> --previous` |
| Init container never finishes | Migration cannot reach PostgreSQL | Check `postgres-0` is Ready and the Secret's `DATABASE_URL` |
| `0/3 nodes available: pod has unbound PVC` | No default StorageClass | `kubectl get sc` — kind provides `standard` |
| Ingress returns 404 | Host header does not match | Use the hosts entry, or the IP (there is a host-less rule) |
| HPA shows `<unknown>/70%` | metrics-server not ready | Needs `--kubelet-insecure-tls` on kind |

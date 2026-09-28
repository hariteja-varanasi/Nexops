# Monitoring and Logging

Three tools, three jobs:

| Tool | Collects | Answers |
|---|---|---|
| Prometheus | Numeric time series | "How many? How fast? How often?" |
| Loki | Log lines | "What exactly happened at 14:32?" |
| Grafana | Neither — it queries both | "Show me" |

Metrics tell you something is wrong. Logs tell you what. You need both.

## Install

```bash
./monitoring/install.sh    # Prometheus + Grafana + the five NexOps dashboards
./logging/install.sh       # Loki + Promtail
```

Then point NexOps at them, so its own Monitoring and Logs pages query the
cluster instead of PostgreSQL:

```bash
helm upgrade nexops ./helm/nexops --reuse-values -n nexops-dev \
  --set config.prometheusUrl=http://prometheus-server.monitoring.svc.cluster.local \
  --set config.lokiUrl=http://loki.logging.svc.cluster.local:3100
```

Until you do, both pages show a banner saying they are reading stored samples.
That banner is deliberate — the API reports `source: "database"` and the UI
says so rather than passing old rows off as live cluster data.

## How Prometheus finds NexOps

Pull, not push. Prometheus scrapes; applications do not send.

The backend annotates itself:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port:   "4000"
  prometheus.io/path:   "/api/metrics"
```

and the `kubernetes-pods` scrape job keeps any pod carrying that annotation.
Deploy a new annotated service and Prometheus discovers it with no config
change.

## The metrics NexOps exposes

```
nexops_http_requests_total{method,route,status}          counter
nexops_http_errors_total{method,route,status}            counter
nexops_http_request_duration_seconds_bucket{...}         histogram
nexops_http_active_requests                              gauge
nexops_deployments_total{environment,status}             counter
nexops_app_info{version,node_version,environment}        gauge, always 1
```

Plus Node.js defaults: heap, event loop lag, GC pauses, open file descriptors.

`route` is the **matched Express route pattern**, not the raw URL. `/api/projects/7`
and `/api/projects/9` both become `/api/projects/:id`. Without that, every
request ID would create a new time series and the memory use would grow without
bound — the classic cardinality mistake.

## PromQL

```promql
# Request rate
sum(rate(nexops_http_requests_total[5m]))

# Error rate as a fraction
sum(rate(nexops_http_errors_total[5m])) / sum(rate(nexops_http_requests_total[5m]))

# p95 latency
histogram_quantile(0.95, sum(rate(nexops_http_request_duration_seconds_bucket[5m])) by (le))

# Slowest five routes
topk(5, histogram_quantile(0.95,
  sum(rate(nexops_http_request_duration_seconds_bucket[5m])) by (le, route)))

# Pods restarting
rate(kube_pod_container_status_restarts_total{namespace=~"nexops-.*"}[15m]) * 60 * 15
```

`rate()` before `sum()`, always. `sum()` then `rate()` produces a meaningless
number when a pod restarts and its counter resets.

## Dashboards

Five, under the NexOps folder in Grafana:

| Dashboard | Shows |
|---|---|
| NexOps Application | Request rate, error rate, latency percentiles, by route |
| NexOps Kubernetes Cluster | Pods by phase, replicas, restarts, PVC usage |
| NexOps Node Resources | CPU, memory, disk and network per kind node |
| NexOps Deployments | Deployment frequency, change failure rate, Argo CD sync state |
| NexOps Application Performance | Latency percentiles, CPU throttling, GC, file descriptors |

Three community dashboards are pulled by ID as well: Kubernetes cluster (315),
Node Exporter Full (1860) and Argo CD (14584).

## Alert rules

Defined in `monitoring/prometheus-values.yaml` and visible at
`http://localhost:9090/alerts`:

`NexOpsBackendDown` · `NexOpsHighErrorRate` (>5% for 5m) ·
`NexOpsSlowResponses` (p95 >1s for 10m) · `PodCrashLooping` ·
`PersistentVolumeFillingUp` (>85%)

Alertmanager is disabled on purpose. Alert routing needs a real destination to
be worth anything, and an Alertmanager that notifies nobody teaches the wrong
lesson. The rules still fire in Prometheus, which is enough to see the idea.

## Loki and LogQL

Promtail runs as a DaemonSet — one agent per node, tailing `/var/log/pods`.
Applications write to stdout and the platform collects it. They never ship their
own logs.

```logql
{namespace="nexops-dev"}                              everything
{namespace="nexops-dev", app="backend"}               one application
{namespace="nexops-dev"} | json | level="ERROR"       errors only
{namespace="nexops-dev"} |= "readinessProbe"          full-text search
{namespace="nexops-dev"} | json | durationMs > 500    slow requests

# Error rate from logs, to cross-check the Prometheus number
sum(rate({namespace="nexops-dev"} | json | level="ERROR" [5m]))
```

**Loki indexes labels, not content.** That is why Promtail promotes only
`level` to a label and leaves `requestId` and `route` as parsed fields. Label by
request ID and you create one stream per request, which destroys the index. This
is the single most important thing to understand about Loki.

## Exercise

1. Generate traffic:
   `for i in $(seq 1 200); do curl -s localhost/api/health > /dev/null; done`
2. In Prometheus, run `sum(rate(nexops_http_requests_total[5m]))`. See the bump.
3. In Grafana, open NexOps Application. Find the same bump on "Requests per second".
4. Run `./scripts/demo-failure.sh`. Watch the error rate climb in Grafana.
5. In Grafana Explore, switch to Loki and run
   `{namespace="nexops-dev"} | json | level="ERROR"`. Find the exact error.
6. That is the full loop: metric shows *something* is wrong, log shows *what*.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No NexOps target in `/targets` | Scrape annotations missing | `kubectl -n nexops-dev get pod <pod> -o yaml \| grep prometheus.io` |
| Grafana shows "No data" | Wrong data source or time range | Check the datasource dropdown; widen to Last 6 hours |
| Loki: `too far behind` | Clock skew between kind nodes and host | `sudo systemctl restart systemd-timesyncd` on the host |
| Promtail pods ≠ node count | Control-plane taint | The toleration is in `promtail-values.yaml` |
| NexOps Monitoring page still says `source: "database"` | `PROMETHEUS_URL` unset | Run the `helm upgrade` above, then check `/api/monitoring/overview` |
| Prometheus pod OOMKilled | Retention or cardinality too high | Lower `server.retention`, or raise the memory limit |

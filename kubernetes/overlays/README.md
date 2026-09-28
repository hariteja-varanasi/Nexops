# Overlays

One base, three environments. Kustomize is built into `kubectl`, so nothing
extra to install.

```bash
# See what would be applied, without applying it
kubectl kustomize kubernetes/overlays/dev

# Apply
kubectl apply -k kubernetes/overlays/dev
kubectl apply -k kubernetes/overlays/staging
kubectl apply -k kubernetes/overlays/prod
```

## What changes per environment

| | dev | staging | prod |
|---|---|---|---|
| Namespace | `nexops-dev` | `nexops-staging` | `nexops-prod` |
| Backend replicas | 1 | 2 | 2 |
| Frontend replicas | 1 | 1 | 2 |
| Image tag | `latest` | `latest` | pinned, e.g. `1.0.0` |
| Log level | `debug` | `info` | `warn` |
| Demo seed data | yes | yes | no — runs `migrate.js`, not `seed.js` |
| NetworkPolicies | no | no | yes |
| Postgres storage | 2Gi | 2Gi | 5Gi |
| Argo CD sync | automatic | automatic | manual approval |

Production pins an exact image tag on purpose. `latest` means the running
version depends on when a pod happened to restart, which makes a rollback
impossible to reason about.

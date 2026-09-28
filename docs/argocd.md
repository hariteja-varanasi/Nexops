# Argo CD and GitOps

## What is GitOps

A deployment model with one rule: **the desired state of the cluster lives in
Git, and a controller continuously makes the cluster match it.**

Nobody runs `kubectl apply` to deploy. You commit. The controller notices and
reconciles.

## Why it is better than `kubectl apply` from CI

| | Push (CI applies) | Pull (Argo CD reconciles) |
|---|---|---|
| What is deployed? | Read CI logs and hope | `cat gitops/production/values.yaml` |
| Who changed it? | Buried in build history | `git log` |
| Rollback | Re-run an old build | `git revert` |
| Manual `kubectl edit` | Persists silently until the next deploy | Reverted within seconds |
| CI credentials | Needs cluster admin | Needs none — it only writes to Git |

That last row matters more than it looks. In the push model, your build server
holds cluster-admin credentials and runs arbitrary code from pull requests. In
the pull model, Argo CD reaches out from inside the cluster and CI never gets a
kubeconfig at all.

## Sync policies, and why they differ per environment

```yaml
# dev — Git is law, instantly
syncPolicy:
  automated: { prune: true, selfHeal: true }

# staging — Git is law, but nothing is deleted
syncPolicy:
  automated: { prune: false, selfHeal: true }

# production — a human approves every change
# (no syncPolicy.automated at all)
```

- **`selfHeal: true`** — Argo CD reverts manual cluster edits. This is what
  makes GitOps more than scripted deploys: `kubectl edit deployment` is undone
  within seconds, because the cluster is not the source of truth.
- **`prune: true`** — objects removed from Git are deleted from the cluster.
  On in dev so experiments clean up after themselves; off in staging so orphans
  can be inspected before removal.
- **No `automated` in production** — the Application shows `OutOfSync` and waits
  for `argocd app sync nexops-prod`. That wait is the promotion gate.

## Install

```bash
./argocd/install.sh
```

It installs Argo CD into the `argocd` namespace, applies
`argocd/applications.yaml`, and prints the generated admin password.

```bash
kubectl -n argocd port-forward svc/argocd-server 8081:443
# https://localhost:8081   (self-signed cert, accept the warning)
```

Rotate the bootstrap password immediately:

```bash
argocd login localhost:8081 --username admin --password '<printed>' --insecure
argocd account update-password
kubectl -n argocd delete secret argocd-initial-admin-secret
```

## Promotion

```
Jenkins → gitops/dev/values.yaml         → auto-syncs
you    → gitops/staging/values.yaml      → auto-syncs
you    → gitops/production/values.yaml   → OutOfSync, waits for approval
```

```bash
# What is running where
grep -r 'tag:' gitops/*/values.yaml

# Promote to staging
sed -i 's|^\( *tag:\).*|\1 "1.0.42"|' gitops/staging/values.yaml
git commit -am "promote 1.0.42 to staging" && git push

# Promote to production, then approve
sed -i 's|^\( *tag:\).*|\1 "1.0.42"|' gitops/production/values.yaml
git commit -am "promote 1.0.42 to production" && git push
argocd app diff nexops-prod        # read what will change
argocd app sync nexops-prod        # approve it
```

## Rollback

Two paths, and the difference matters:

```bash
# Fast, for an incident. Leaves the cluster ahead of Git.
argocd app rollback nexops-prod

# Correct. Git stays the source of truth.
git revert <the tag-bump commit>
git push
```

Use `argocd app rollback` when the site is down and seconds count — then follow
it with the Git revert. Skip that follow-up and the next sync puts the broken
version straight back.

## Commands

```bash
argocd app list
argocd app get nexops-dev
argocd app diff nexops-prod              # desired vs actual
argocd app sync nexops-prod
argocd app history nexops-prod
argocd app rollback nexops-prod 3

# Without the CLI
kubectl -n argocd get applications
kubectl -n argocd describe application nexops-dev
```

## Exercise

1. `kubectl -n nexops-dev scale deployment nexops-backend --replicas=5`, then
   `kubectl -n nexops-dev get pods -w`. Watch Argo CD undo it. That is
   `selfHeal`.
2. Change `backend.replicaCount` in `gitops/dev/values.yaml`, commit, push.
   Watch the same change stick this time. Explain the difference.
3. Bump `gitops/production/values.yaml` and push. Confirm nothing happens.
   Run `argocd app diff nexops-prod` to see exactly what is pending.
4. Approve with `argocd app sync nexops-prod`.
5. `git revert` the production commit. Watch it roll back with no cluster
   command at all.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ComparisonError: repository not accessible` | Private repo, no credentials | `argocd repo add <url> --username x --password <PAT>` |
| Stuck `OutOfSync`, nothing happens | Production has no `automated` policy — working as designed | `argocd app sync nexops-prod` |
| `SyncFailed: namespace not found` | Namespace missing | `CreateNamespace=true` is set in `syncOptions` |
| Your `kubectl edit` keeps reverting | `selfHeal` — working as designed | Change Git, not the cluster |
| App is `Synced` but `Degraded` | Manifests applied; pods unhealthy | `kubectl -n <ns> describe pod` — it is an app problem, not a sync problem |
| Changes take up to 3 minutes | Default Git poll interval | `argocd app sync`, or add a GitHub webhook to Argo CD |

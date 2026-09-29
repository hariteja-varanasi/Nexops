# GitOps

The desired state of every environment. Argo CD reads these files and makes the
cluster match them.

**Jenkins writes here. Nothing else should.** The pipeline's last real action is
a `sed` on `values.yaml` followed by a commit — that commit is the handover from
CI to CD.

```
gitops/
├── dev/values.yaml          Argo CD: auto-sync, self-heal, prune
├── staging/values.yaml      Argo CD: auto-sync, self-heal
└── production/values.yaml   Argo CD: MANUAL sync
```

## How a change reaches production

```
commit to main
      │
      ▼
Jenkins builds, scans, pushes  →  docker.io/haritejarv/nexops-backend:1.0.42
      │
      ▼
Jenkins rewrites gitops/dev/values.yaml   tag: "1.0.42"
      │
      ▼
Argo CD sees the commit, syncs nexops-dev automatically
      │
      ▼
you verify dev, then edit gitops/staging/values.yaml by hand → syncs
      │
      ▼
you edit gitops/production/values.yaml → Argo CD shows OutOfSync and waits
      │
      ▼
argocd app sync nexops-prod            ← the promotion gate
```

## Promoting by hand

```bash
# What is running where
grep -r 'tag:' gitops/*/values.yaml

# Promote dev's tag to staging
sed -i 's|^\( *tag:\).*|\1 "1.0.42"|' gitops/staging/values.yaml
git commit -am "promote 1.0.42 to staging" && git push

# Production: commit, then approve
sed -i 's|^\( *tag:\).*|\1 "1.0.42"|' gitops/production/values.yaml
git commit -am "promote 1.0.42 to production" && git push
argocd app sync nexops-prod
```

## Rolling back

The rollback is a Git revert, not a cluster command:

```bash
git revert HEAD          # undo the tag bump
git push                 # Argo CD syncs back to the previous version
```

`argocd app rollback nexops-prod` also works and is faster in an incident, but
it leaves the cluster ahead of Git — Argo CD will show OutOfSync until you
commit the revert too.

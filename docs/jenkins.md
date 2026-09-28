# Jenkins

## What is it

An automation server. It watches the repository and runs a defined sequence of
steps on every change.

## Why NexOps uses it

Because the alternative is a human remembering to run the tests, the scan and
the build in the right order, every time, without shortcuts on a Friday. CI
makes that sequence unskippable.

## The pipeline

Ten stages, in `Jenkinsfile` at the repository root:

```
Checkout                clone the triggering commit
Install Dependencies    npm ci in backend and frontend
Lint                    ESLint
Unit Tests              node --test, against throwaway Postgres and Redis
SonarQube Analysis      bugs, vulnerabilities, smells, duplication, coverage
Quality Gate            blocks until SonarQube's verdict arrives
Docker Build            both images, tagged with build number and commit SHA
Trivy Scan              fails on fixable HIGH/CRITICAL
Push to Docker Hub      both tags
Update GitOps Manifest  commit the new tag → Argo CD takes over
```

## The important design decision

Jenkins never runs `kubectl apply`. Its last real action is:

```bash
sed -i "s|^\( *tag:\).*|\1 \"${IMAGE_TAG}\"|" gitops/dev/values.yaml
git commit -m "deploy(dev): nexops ${IMAGE_TAG}" && git push
```

That commit is the handover from CI to CD. Everything before it is Jenkins;
everything after is Argo CD. The benefit: what is running is described by a file
in Git, so `git log` answers "what changed and when", and `git revert` is a
rollback.

## Credentials

Three, added once through the UI. **Never in the Jenkinsfile.**

| ID | Kind | What |
|---|---|---|
| `dockerhub-credentials` | Username with password | Docker Hub user + access token |
| `sonarqube-token` | Secret text | SonarQube → My Account → Security |
| `github-credentials` | Username with password | GitHub user + PAT with `repo` scope |

Used like this, so the value never reaches the console log:

```groovy
withCredentials([usernamePassword(credentialsId: 'dockerhub-credentials',
                                  usernameVariable: 'DH_USER',
                                  passwordVariable: 'DH_TOKEN')]) {
  sh 'echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin'
}
```

`--password-stdin`, not `-p "$TOKEN"`. A password on the command line is visible
in `ps` output to every other process on the machine.

## Docker-outside-of-Docker

`jenkins/docker-compose.yml` mounts the host's Docker socket:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

The pipeline's `docker build` therefore runs on the **host** daemon, not a
nested one. Faster, and the layer cache is shared with everything else on the
box.

The trade-off is real: this grants the Jenkins container root on the host.
Acceptable on a disposable training instance, not acceptable at work. There, use
rootless agents or Kaniko.

## Starting it

```bash
cd jenkins
cp .env.example .env
sed -i "s|^JENKINS_ADMIN_PASSWORD=.*|JENKINS_ADMIN_PASSWORD=$(openssl rand -base64 18)|" .env
sed -i "s|^SONAR_DB_PASSWORD=.*|SONAR_DB_PASSWORD=$(openssl rand -base64 18)|" .env
docker compose up -d --build
docker compose logs -f jenkins
```

Jenkins is configured by JCasC (`jenkins/casc.yaml`), so the admin user, the
SonarQube server and the `nexops` pipeline job all exist on first boot — no
setup wizard, and deleting the volume reproduces the same Jenkins exactly.

## The webhook

GitHub → Settings → Webhooks:

```
Payload URL   http://<public-ip>:8080/github-webhook/
Content type  application/json
Events        Just the push event
```

The JCasC job also polls every 2 minutes as a fallback, for boxes with no
publicly reachable webhook endpoint.

## Commands

```bash
docker compose logs -f jenkins
docker compose restart jenkins
docker compose exec jenkins bash

# Confirm the pipeline's tools are present in the container
docker compose exec jenkins sh -c 'docker --version && kubectl version --client && node -v'
```

## Exercise

1. Change the dashboard title in `frontend/src/pages/Login.jsx`, commit, push.
2. Watch the build in Blue Ocean. Which stage takes longest? Why?
3. Deliberately break a test and push. Confirm the pipeline stops at Unit Tests
   and that **no image was pushed** to Docker Hub.
4. Fix it, push, and watch `gitops/dev/values.yaml` gain a new commit.
5. `git log --oneline -- gitops/dev/values.yaml` — every deployment, in order.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `docker: not found` in a stage | Docker CLI missing from the image | Rebuild: `docker compose build jenkins` |
| `permission denied` on the socket | Container not running as root | The compose file sets `user: root` |
| Quality Gate hangs 10 minutes | SonarQube cannot reach Jenkins back | Set the webhook in SonarQube → Administration → Configuration → Webhooks |
| Tests fail: `ECONNREFUSED postgres` | Test containers not on the `jenkins` network | They use `--network jenkins`; check the network exists |
| GitOps push rejected | PAT lacks `repo` scope or expired | Regenerate the token |
| Build passes but nothing deploys | Argo CD polls every 3 minutes | Wait, or `argocd app sync nexops-dev` |

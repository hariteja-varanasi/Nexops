# Installation

Three routes, depending on where you are starting.

| Route | Time | Needs |
|---|---|---|
| [Local, Docker Compose](#a-local-with-docker-compose) | ~4 min | Docker |
| [Local, kind](#b-local-with-kind) | ~10 min | Docker, kind, kubectl, Helm |
| [AWS EC2, full platform](#c-aws-ec2-the-full-platform) | ~35 min | An AWS account |

---

## A. Local with Docker Compose

The fastest way to see the application. No Kubernetes involved.

```bash
git clone https://github.com/ravinadh777/e2edevopsproject.git nexops
cd nexops

cp .env.example .env
# Generate real secrets instead of using the placeholders:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env

docker compose up -d --build
```

**Expected output** — five services, with `migrate` having exited cleanly:

```
NAME               STATUS
nexops-postgres    Up (healthy)
nexops-redis       Up (healthy)
nexops-migrate     Exited (0)
nexops-backend     Up
nexops-frontend    Up
```

**Verify**

```bash
curl -s localhost:4000/api/health | jq
# {"status":"UP","database":"UP","redis":"UP","version":"1.0.0", ...}

open http://localhost          # admin / admin123
```

**Stop**

```bash
docker compose down       # keep the data
docker compose down -v    # delete the data too
```

---

## B. Local with kind

```bash
./scripts/setup-ec2.sh      # installs kind, kubectl, Helm if missing
newgrp docker               # picks up the docker group in this shell
./setup.sh
```

`setup.sh` runs thirteen steps: prerequisite checks, `.env` generation, cluster
creation, image build, image load, Secret creation, the Helm install, rollout
verification, an in-cluster health check and a hosts entry.

**Expected output**, abbreviated:

```
==> 3/13  kind cluster
    ✓ cluster created
    ✓ ingress-nginx ready on host ports 80 and 443
==> 5/13  Loading images into kind
    ✓ nexops-backend:local loaded
==> 9/13  Verifying the deployment
    ✓ the API reports healthy

  http://nexops-dev.local
  Sign in:  admin / admin123
```

**Verify**

```bash
kubectl -n nexops-dev get pods
# nexops-backend-xxxx    1/1  Running
# nexops-frontend-xxxx   1/1  Running
# nexops-postgres-0      1/1  Running
# nexops-redis-xxxx      1/1  Running

curl -s http://nexops-dev.local/api/health | jq
```

---

## C. AWS EC2, the full platform

### 1. Provision

```bash
aws ec2 create-key-pair --key-name nexops-key \
  --query 'KeyMaterial' --output text > nexops-key.pem
chmod 400 nexops-key.pem

cd terraform
terraform init
terraform apply \
  -var="key_name=nexops-key" \
  -var="allowed_ssh_cidr=$(curl -s ifconfig.me)/32"

terraform output next_steps
```

`t3.xlarge` (4 vCPU, 16 GiB) is the default and is what the full stack needs.
`t3.large` works if you skip SonarQube.

### 2. Install

```bash
ssh -i nexops-key.pem ubuntu@$(terraform output -raw public_ip)

cd ~/nexops
./scripts/setup-ec2.sh
newgrp docker
./setup.sh --everything
```

`--everything` adds Argo CD, Prometheus, Grafana, Loki, Jenkins and SonarQube.
Allow about 25 minutes; most of it is image pulls.

### 3. Reach it

| What | Where |
|---|---|
| NexOps | `http://<public-ip>` |
| Jenkins | `http://<public-ip>:8080` — password in `jenkins/.env` |
| SonarQube | `http://<public-ip>:9000` — `admin`/`admin`, change on first login |
| Argo CD | `kubectl -n argocd port-forward svc/argocd-server 8081:443` |
| Grafana | `kubectl -n monitoring port-forward svc/grafana 3000:80` |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` |

Argo CD, Grafana and Prometheus are reached by port-forward on purpose. The
security group only opens those ports to your own CIDR, and port-forwarding
keeps them off the public internet entirely.

### 4. Wire up CI

One-time, in the Jenkins UI — **Manage Jenkins → Credentials → System → Global**:

| ID | Kind | Value |
|---|---|---|
| `dockerhub-credentials` | Username with password | Docker Hub user + an access token |
| `sonarqube-token` | Secret text | SonarQube → My Account → Security → Generate |
| `github-credentials` | Username with password | GitHub user + a PAT with `repo` scope |

Use a Docker Hub **access token**, never your account password — a token can be
revoked without changing your login.

Then in GitHub → Settings → Webhooks:

```
Payload URL   http://<public-ip>:8080/github-webhook/
Content type  application/json
Events        Just the push event
```

---

## Teardown

```bash
./setup.sh --clean                 # the cluster only
cd jenkins && docker compose down -v
cd terraform && terraform destroy -var="key_name=nexops-key" -var="allowed_ssh_cidr=$(curl -s ifconfig.me)/32"
```

A `t3.xlarge` left running is roughly $140/month. Destroy it when you are done
for the day; `terraform apply` rebuilds it in about two minutes.

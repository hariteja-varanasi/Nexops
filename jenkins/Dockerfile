# Jenkins with the tools the NexOps pipeline shells out to.
FROM jenkins/jenkins:2.479.1-lts-jdk17

USER root

# docker CLI only — the daemon is the host's, via the mounted socket.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg lsb-release git jq \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
 && rm -rf /var/lib/apt/lists/*

# kubectl and the Argo CD CLI, for the sync stage.
RUN curl -fsSLo /usr/local/bin/kubectl \
      "https://dl.k8s.io/release/v1.29.2/bin/linux/amd64/kubectl" \
 && chmod +x /usr/local/bin/kubectl \
 && curl -fsSLo /usr/local/bin/argocd \
      "https://github.com/argoproj/argo-cd/releases/download/v2.12.4/argocd-linux-amd64" \
 && chmod +x /usr/local/bin/argocd

# Node for the lint and test stages.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

USER jenkins

// =====================================================================
// NexOps CI/CD pipeline
//
//   Checkout -> Install -> Lint -> Test -> SonarQube -> Quality Gate
//            -> Docker Build -> Trivy -> Push to Docker Hub
//            -> Update GitOps manifest -> Argo CD syncs the cluster
//
// Jenkins never runs kubectl apply. It writes the new image tag into Git and
// stops. Argo CD is what changes the cluster. That separation is the whole
// point of GitOps: the cluster follows Git, not a build server.
//
// Credentials this expects in the Jenkins credentials store (see jenkins/README.md):
//   dockerhub-credentials  Username/password - Docker Hub user + access token
//   sonarqube-token        Secret text
//   github-credentials     Username/password - GitHub user + PAT, for the GitOps push
// =====================================================================

pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()          // two runs writing the GitOps repo would race
    skipDefaultCheckout(true)
  }

  environment {
    DOCKERHUB_USERNAME = 'ravinadh777'
    BACKEND_IMAGE      = "${DOCKERHUB_USERNAME}/nexops-backend"
    FRONTEND_IMAGE     = "${DOCKERHUB_USERNAME}/nexops-frontend"

    // Two tags per image. The immutable one is what the GitOps manifest pins,
    // so every deployment is traceable to one commit. `latest` is convenience
    // for dev only and is never referenced by the production overlay.
    IMAGE_TAG          = "1.0.${BUILD_NUMBER}"

    SONAR_HOST_URL     = 'http://sonarqube:9000'
    SONAR_PROJECT_KEY  = 'nexops'

    GITOPS_REPO        = 'https://github.com/ravinadh777/e2edevopsproject.git'
    GITOPS_BRANCH      = 'main'

    // Argo CD auto-syncs dev on every push. Promotion to staging and production
    // is a deliberate act, so those are parameters rather than automatic.
    DEPLOY_ENV         = 'dev'

    NEXOPS_API         = 'http://nexops-dev.local/api'
  }

  parameters {
    booleanParam(name: 'SKIP_TESTS',   defaultValue: false, description: 'Skip unit tests (never for main)')
    booleanParam(name: 'SKIP_SONAR',   defaultValue: false, description: 'Skip SonarQube analysis')
    choice(name: 'TRIVY_SEVERITY', choices: ['HIGH,CRITICAL', 'CRITICAL', 'MEDIUM,HIGH,CRITICAL'],
           description: 'Severities that fail the build')
  }

  stages {

    stage('Checkout') {
      steps {
        script { env.STAGE_START = System.currentTimeMillis().toString() }
        checkout scm
        script {
          env.GIT_COMMIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.GIT_BRANCH_NAME  = sh(script: 'git rev-parse --abbrev-ref HEAD', returnStdout: true).trim()
          echo "Building ${env.GIT_BRANCH_NAME} at ${env.GIT_COMMIT_SHORT} as ${IMAGE_TAG}"
        }
        reportStage('Checkout', 'SUCCESS')
      }
    }

    stage('Install Dependencies') {
      steps {
        // npm ci, not npm install: it installs exactly the lockfile and fails
        // if package.json and the lockfile disagree.
        dir('backend')  { sh 'npm ci' }
        dir('frontend') { sh 'npm ci' }
        reportStage('Install Dependencies', 'SUCCESS')
      }
    }

    stage('Lint') {
      steps {
        dir('backend')  { sh 'npm run lint' }
        dir('frontend') { sh 'npm run lint' }
        reportStage('Lint', 'SUCCESS')
      }
    }

    stage('Unit Tests') {
      when { expression { !params.SKIP_TESTS } }
      steps {
        // Tests need a real database and cache. Throwaway containers on the
        // Jenkins network, torn down in post{} whatever happens.
        sh '''
          docker rm -f nexops-ci-pg nexops-ci-redis >/dev/null 2>&1 || true
          docker run -d --name nexops-ci-pg    --network jenkins \
            -e POSTGRES_DB=nexops -e POSTGRES_USER=nexops -e POSTGRES_PASSWORD=ci_password \
            postgres:16-alpine
          docker run -d --name nexops-ci-redis --network jenkins redis:7-alpine

          echo "waiting for postgres"
          for i in $(seq 1 30); do
            docker exec nexops-ci-pg pg_isready -U nexops -d nexops && break
            sleep 2
          done
        '''
        dir('backend') {
          sh '''
            export DATABASE_URL=postgresql://nexops:ci_password@nexops-ci-pg:5432/nexops
            export REDIS_URL=redis://nexops-ci-redis:6379
            export JWT_SECRET=ci-only-secret
            export NODE_ENV=test
            npm run seed
            npm test
          '''
        }
        reportStage('Unit Tests', 'SUCCESS')
      }
      post {
        always {
          sh 'docker rm -f nexops-ci-pg nexops-ci-redis >/dev/null 2>&1 || true'
        }
        failure { reportStage('Unit Tests', 'FAILED') }
      }
    }

    stage('SonarQube Analysis') {
      when { expression { !params.SKIP_SONAR } }
      steps {
        withCredentials([string(credentialsId: 'sonarqube-token', variable: 'SONAR_TOKEN')]) {
          withSonarQubeEnv('SonarQube') {
            sh '''
              docker run --rm --network jenkins \
                -v "$(pwd):/usr/src" \
                -e SONAR_HOST_URL="${SONAR_HOST_URL}" \
                -e SONAR_TOKEN="${SONAR_TOKEN}" \
                sonarsource/sonar-scanner-cli:latest \
                -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
                -Dsonar.projectVersion="${IMAGE_TAG}"
            '''
          }
        }
        reportStage('SonarQube Analysis', 'SUCCESS')
      }
      post { failure { reportStage('SonarQube Analysis', 'FAILED') } }
    }

    stage('Quality Gate') {
      when { expression { !params.SKIP_SONAR } }
      steps {
        // Blocks until SonarQube posts back its verdict. abortPipeline: true is
        // what makes the gate real rather than decorative — without it a failing
        // gate just prints a warning and the build ships anyway.
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Docker Build') {
      steps {
        sh """
          docker build -t ${BACKEND_IMAGE}:${IMAGE_TAG} \
                       -t ${BACKEND_IMAGE}:${GIT_COMMIT_SHORT} \
                       ./backend
          docker build -t ${FRONTEND_IMAGE}:${IMAGE_TAG} \
                       -t ${FRONTEND_IMAGE}:${GIT_COMMIT_SHORT} \
                       ./frontend
          docker images | grep nexops
        """
        reportStage('Docker Build', 'SUCCESS')
      }
      post { failure { reportStage('Docker Build', 'FAILED') } }
    }

    stage('Trivy Scan') {
      steps {
        script {
          sh 'mkdir -p trivy-reports'
          def failed = false

          ['backend', 'frontend'].each { component ->
            def image = component == 'backend' ? "${BACKEND_IMAGE}" : "${FRONTEND_IMAGE}"

            // Two passes on purpose. The first is informational and always
            // succeeds, so the report exists even when the gate fails. The
            // second sets the exit code.
            sh """
              docker run --rm \
                -v /var/run/docker.sock:/var/run/docker.sock \
                -v \$HOME/.cache/trivy:/root/.cache/trivy \
                aquasec/trivy:latest image \
                --format table --output /dev/stdout \
                --severity LOW,MEDIUM,HIGH,CRITICAL \
                ${image}:${IMAGE_TAG} | tee trivy-reports/${component}.txt
            """

            def status = sh(
              returnStatus: true,
              script: """
                docker run --rm \
                  -v /var/run/docker.sock:/var/run/docker.sock \
                  -v \$HOME/.cache/trivy:/root/.cache/trivy \
                  aquasec/trivy:latest image \
                  --exit-code 1 \
                  --severity ${params.TRIVY_SEVERITY} \
                  --ignore-unfixed \
                  ${image}:${IMAGE_TAG}
              """
            )
            if (status != 0) {
              failed = true
              echo "TRIVY: FAIL — ${component} has unresolved ${params.TRIVY_SEVERITY} findings"
            } else {
              echo "TRIVY: PASS — ${component} clean at ${params.TRIVY_SEVERITY}"
            }
          }

          if (failed) {
            reportStage('Trivy Scan', 'FAILED')
            // --ignore-unfixed means everything reported here HAS a fix
            // available. Rebuild on a newer base image rather than suppressing it.
            error('Trivy gate failed. A fixed version exists for at least one finding.')
          }
          reportStage('Trivy Scan', 'SUCCESS')
        }
      }
      post {
        always { archiveArtifacts artifacts: 'trivy-reports/*.txt', allowEmptyArchive: true }
      }
    }

    stage('Push to Docker Hub') {
      steps {
        withCredentials([usernamePassword(
          credentialsId: 'dockerhub-credentials',
          usernameVariable: 'DH_USER',
          passwordVariable: 'DH_TOKEN')]) {
          sh '''
            echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin
            docker push ''' + "${BACKEND_IMAGE}:${IMAGE_TAG}" + '''
            docker push ''' + "${BACKEND_IMAGE}:${GIT_COMMIT_SHORT}" + '''
            docker push ''' + "${FRONTEND_IMAGE}:${IMAGE_TAG}" + '''
            docker push ''' + "${FRONTEND_IMAGE}:${GIT_COMMIT_SHORT}" + '''
            docker logout
          '''
        }
        reportStage('Push to Docker Hub', 'SUCCESS')
      }
      post { failure { reportStage('Push to Docker Hub', 'FAILED') } }
    }

    stage('Update GitOps Manifest') {
      steps {
        withCredentials([usernamePassword(
          credentialsId: 'github-credentials',
          usernameVariable: 'GIT_USER',
          passwordVariable: 'GIT_TOKEN')]) {
          sh '''
            set -e
            git config user.email "jenkins@nexops.local"
            git config user.name  "Jenkins"

            # Rewrite the image tag in the GitOps values file for this environment.
            # This commit is the handover point: CI ends here, CD starts when
            # Argo CD notices it.
            FILE="gitops/${DEPLOY_ENV}/values.yaml"
            sed -i "s|^\\( *tag:\\).*|\\1 \\"${IMAGE_TAG}\\"|" "$FILE"

            git add "$FILE"
            if git diff --cached --quiet; then
              echo "no manifest change; nothing to commit"
            else
              git commit -m "deploy(${DEPLOY_ENV}): nexops ${IMAGE_TAG} from ${GIT_COMMIT_SHORT} [skip ci]"
              git push "https://${GIT_USER}:${GIT_TOKEN}@github.com/ravinadh777/e2edevopsproject.git" HEAD:${GITOPS_BRANCH}
              echo "pushed GitOps update for ${IMAGE_TAG}"
            fi
          '''
        }
        reportStage('Update GitOps Manifest', 'SUCCESS')
      }
      post { failure { reportStage('Update GitOps Manifest', 'FAILED') } }
    }

    stage('Argo CD Sync') {
      steps {
        // The dev Application has automated sync, so this stage only waits and
        // confirms. If Argo CD is unreachable the build still passes: the
        // desired state is safely in Git and will reconcile on its own.
        script {
          echo "Argo CD polls Git every 3 minutes; nudging it for a faster demo."
          sh '''
            if command -v argocd >/dev/null 2>&1; then
              argocd app sync nexops-${DEPLOY_ENV} --grpc-web || echo "argocd sync skipped"
              argocd app wait nexops-${DEPLOY_ENV} --health --timeout 300 --grpc-web || true
            else
              echo "argocd CLI not on this agent; Argo CD will self-sync within 3 minutes"
            fi
          '''
        }
        reportStage('Argo CD Sync', 'SUCCESS')
      }
    }
  }

  post {
    success {
      echo """
      ============================================================
        BUILD ${BUILD_NUMBER} PASSED
        Images   ${BACKEND_IMAGE}:${IMAGE_TAG}
                 ${FRONTEND_IMAGE}:${IMAGE_TAG}
        Commit   ${env.GIT_COMMIT_SHORT}
        GitOps   gitops/${DEPLOY_ENV}/values.yaml updated
        Watch    kubectl -n nexops-${DEPLOY_ENV} get pods -w
      ============================================================
      """
    }
    failure {
      echo """
      ============================================================
        BUILD ${BUILD_NUMBER} FAILED
        The cluster was not changed. Whatever is running now is
        still the last version that passed every gate.
        Open the failing stage above for its console output.
      ============================================================
      """
    }
    always {
      sh 'docker image prune -f --filter "until=24h" || true'
      cleanWs(deleteDirs: true, notFailBuild: true)
    }
  }
}

// Reports stage results back to the NexOps API so the Deployments page shows
// the same pipeline Jenkins just ran. Best-effort: a NexOps outage must never
// fail a build.
void reportStage(String stageName, String status) {
  script {
    def elapsed = env.STAGE_START ? (System.currentTimeMillis() - env.STAGE_START.toLong()) : 0
    env.STAGE_START = System.currentTimeMillis().toString()
    sh(returnStatus: true, script: """
      curl -sS -m 5 -X PUT "${NEXOPS_API}/deployments/\${NEXOPS_DEPLOYMENT_ID:-0}/stage" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer \${NEXOPS_TOKEN:-}" \
        -d '{"stage":"${stageName}","status":"${status}","durationMs":${elapsed}}' >/dev/null || true
    """)
  }
}

# The job image: catthehacker's act image (Node, git, docker CLI + compose) plus the tools GitHub's own
# ubuntu-24.04 runner image has and our workflows use (aws, shellcheck, jq, unzip).
FROM catthehacker/ubuntu:act-24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq unzip shellcheck make curl ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*
RUN arch="$(uname -m)" \
 && curl -sfL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o /tmp/awscli.zip \
 && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip
# trivy, so the workflows can skip the trivy-action's own installer here (it downloads from github.com
# with the job token, which Gitea's token cannot authenticate).
ARG TRIVY_VERSION=0.70.0
RUN arch="$(uname -m | sed 's/x86_64/64bit/;s/aarch64/ARM64/')" \
 && curl -sfL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${arch}.tar.gz" | tar -xz -C /usr/local/bin trivy \
 && trivy --version | head -1
# The shared Playwright suite (deployment/smoke, @playwright/test 1.63.0) needs Chromium and the system
# libraries it runs on; GitHub's hosted image has both, this one gets them here. Chromium is baked in
# (PLAYWRIGHT_BROWSERS_PATH) so a job never downloads ~150 MB from Google at run time: that download timed
# out after 30 s in the slowest pipeline runs. Keep the version in step with deployment/smoke/package-lock.json.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=180000
RUN npx --yes playwright@1.63.0 install-deps chromium \
 && npx --yes playwright@1.63.0 install chromium \
 && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/* /root/.npm
# Stages that run over HTTPS (aws/ecs-cloudfront-signup-https) make a throwaway local CA with mkcert in every job.
# libnss3-tools (certutil) lets `mkcert -install` also put that CA where Chromium looks, so the browser tests trust it.
RUN apt-get update && apt-get install -y --no-install-recommends libnss3-tools && rm -rf /var/lib/apt/lists/* \
 && curl -sfL "https://dl.filippo.io/mkcert/latest?for=linux/$(dpkg --print-architecture)" -o /usr/local/bin/mkcert \
 && chmod +x /usr/local/bin/mkcert && mkcert -version

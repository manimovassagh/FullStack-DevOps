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

# The job image: catthehacker's act image (Node, git, docker CLI + compose) plus the tools GitHub's own
# ubuntu-24.04 runner image has and our workflows use (aws, shellcheck, jq, unzip).
FROM catthehacker/ubuntu:act-24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq unzip shellcheck make curl ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*
RUN arch="$(uname -m)" \
 && curl -sfL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o /tmp/awscli.zip \
 && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip

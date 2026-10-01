# Our "AMI": Ubuntu 24.04 with systemd as PID 1 plus sshd, baked like Packer would.
# `make ami` tags it plant/ami-ubuntu-systemd:24.04-<arch>; ami/image-catalog.yaml
# registers that tag with Floci as AMI ami-plant-ubuntu2404-<arch>.
FROM public.ecr.aws/docker/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus openssh-server ca-certificates curl python3 \
 && rm -rf /var/lib/apt/lists/* \
 && systemctl enable ssh \
 && systemctl mask getty@tty1.service console-getty.service systemd-firstboot.service systemd-udevd.service systemd-modules-load.service \
 && mkdir -p /run/sshd

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]

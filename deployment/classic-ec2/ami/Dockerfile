# Local stand-in for an Ubuntu 24.04 cloud AMI: systemd as PID 1 plus sshd.
# Floci maps the AMI alias `ami-ubuntu2404-cloud` to the image tag
# floci/ami-ubuntu:24.04-<arch>, which is not published; building it locally
# under that tag makes Floci use it (same idea as baking an AMI with Packer).
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

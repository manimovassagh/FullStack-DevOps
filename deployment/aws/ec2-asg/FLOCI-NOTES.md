# Floci notes for the ec2-asg stage

Verified against Floci 2.1.0 (pinned in docker-compose). Everything in [classic-ec2's notes](../classic-ec2/FLOCI-NOTES.md) applies unchanged (the arm64 Ubuntu "AMI" container, user data, the Floci container joining the VPC network, QEMU on amd64 hosts).

## What works like real AWS

- **A real capacity reconciler.** Floci checks every 10 s that each group has `DesiredCapacity` InService instances; it calls `RunInstances` from the launch template to scale out and terminates instances to scale in.
- **Target group registration.** Instances launched by a group are registered with the attached target groups on InService and deregistered on termination.
- **Self-healing.** An instance terminated through the EC2 API disappears from the group's InService set and the reconciler launches a replacement.
- **Launch templates with versions** (`$Latest`) and `set-desired-capacity`, `terminate-instance-in-auto-scaling-group` (with decrement).

## Differences

- **No instance refresh.** `StartInstanceRefresh` is not among the 45 implemented operations, so `scripts/roll.sh` replaces instances by hand (see the README). On AWS use the `instance_refresh` block on the group.
- **Scaling policies are stored, not driven.** The target-tracking policy is accepted but no CloudWatch metrics feed it, so nothing scales on CPU. Floci also reports `enabled = false` and a default cooldown on it; both are in `ignore_changes` or every plan would show a change.
- **Launch-template tags and default tags** are not stored (`ignore_changes` on the template).
- **`desired_capacity` is ignored by Terraform on purpose** (it is steered at runtime), which also keeps the plan clean when `roll.sh` has changed it.
- **Port.** The ALB listener is 87, published as host port 8093 by `docker-compose.yml`.
- **Not much capacity.** One instance per tier: each is a systemd container, and a roll briefly runs two per tier.

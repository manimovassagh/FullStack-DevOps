# ec2-asg: EC2 behind Auto Scaling Groups

The classic-ec2 recipe (native Go binary + React bundle, installed by user data on Ubuntu instances, no containers) with the two hand-made instances replaced by **launch templates and Auto Scaling Groups**. The group, not Terraform, owns the instances: it launches them, registers them with the ALB, replaces the ones that die, and can add more.

```
Browser ─► ALB localhost:8093 ─┬─ /api/* ─► target group backend  ◄─ Auto Scaling Group backend  ◄─ launch template backend  (AMI, profile, SG, user data)
                               └─ /*     ─► target group frontend ◄─ Auto Scaling Group frontend ◄─ launch template frontend
 backend instances ─► RDS Postgres (secret read at boot)  ─► S3 plant-asg-media
```

## Run it

    make up                  # repo root first: Postgres + Floci
    cd deployment/aws/ec2-asg
    make init
    make apply               # build artifacts + bake the AMI + terraform apply
    make wait                # the groups launched instances; wait until both target groups are healthy
    make smoke               # API + browser tests through http://localhost:8093
    make instances           # what each group runs
    make destroy

Day two with a group:

    make deploy RELEASE=r2   # a new launch-template VERSION. Running instances are untouched!
    make roll                # replace every instance with one from the latest version, one at a time
    make rollout             # the whole journey as a test (below)

## The lesson: a group does not replace instances by itself

Changing a launch template creates a new numbered *version*; instances that already run keep the old one. AWS gives you **instance refresh** to replace them gradually (min healthy percentage, warm-up). Floci 2.1.0 doesn't implement it, so [`scripts/roll.sh`](scripts/roll.sh) does the same job by hand: for each old instance, add one (launched from `$Latest`), wait until it is InService and every target is healthy, terminate the old one with `--should-decrement-desired-capacity`. Capacity never drops.

`make rollout` asserts: (1) a new launch-template version appears but the running instance ids do not change, (2) after `make roll` every instance id is new and the app passes its API smoke test, (3) **self-healing**: an instance terminated behind the group's back (`ec2 terminate-instances`) is replaced and the app is healthy again.

## What changed from classic-ec2

| | classic-ec2 | ec2-asg |
|---|---|---|
| instances | two `aws_instance` | two launch templates + two Auto Scaling Groups |
| who registers targets | `aws_lb_target_group_attachment` | the group (`target_group_arns`) |
| an instance dies | it stays dead | the group launches a replacement (health check type `ELB`) |
| new release | `user_data_replace_on_change` replaces the instance | new template version, then `make roll` (or instance refresh) |
| scaling | none | min/desired/max, and a target-tracking CPU policy (declared) |
| user data | plain | base64, in the launch template |

Sizes are `asg_sizes` in `variables.tf`: min 1, desired 1, max 2 per tier, because instances are heavy under emulation. A real setup keeps at least two, spread over two AZs. `desired_capacity` is in `ignore_changes`: it is steered at runtime (`make roll`, scaling policies), and Terraform would otherwise reset it.

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md). The classic-ec2 notes (the AMI, the VPC network join, QEMU) apply too.

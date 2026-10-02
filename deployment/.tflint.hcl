# Shared tflint rules for every deployment stage (run from the stage directory with
# `tflint --config ../.tflint.hcl`). The terraform ruleset catches unused declarations,
# missing types/descriptions-free typos, deprecated syntax and unpinned providers.
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.40.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

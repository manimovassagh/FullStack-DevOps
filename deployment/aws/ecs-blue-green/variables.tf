variable "region" {
  type    = string
  default = "us-east-1"
}

variable "floci_endpoint" {
  description = "Floci URL as seen from this machine (Terraform, AWS CLI, docker push)."
  type        = string
  default     = "http://localhost:4566"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-ecs-bg"
}

# ── Release state ───────────────────────────────────────────────────────────
# `make release|canary|promote|rollback|finalize` rewrite build/release.auto.tfvars.json
# (see scripts/release.sh) and run terraform apply. These are the knobs it turns.

variable "blue_tag" {
  description = "Image tag the blue environment runs. Blue is the stable one: it is live after `make up` and after `make finalize`."
  type        = string
}

variable "green_tag" {
  description = "Image tag the green (candidate) environment runs. Empty means: same as blue."
  type        = string
  default     = ""
}

variable "blue_count" {
  description = "Tasks per service in blue."
  type        = number
  default     = 1
}

variable "green_count" {
  description = "Tasks per service in green. 0 means green is not running."
  type        = number
  default     = 0
}

variable "green_weight" {
  description = "Percent of user traffic sent to green (0-100); the rest goes to blue."
  type        = number
  default     = 0

  validation {
    condition     = var.green_weight >= 0 && var.green_weight <= 100
    error_message = "green_weight must be between 0 and 100."
  }
}

variable "alb_listener_port" {
  description = "Public listener port inside Floci (weighted blue/green). 83: the other stages use 80-82."
  type        = number
  default     = 83
}

variable "alb_preview_port" {
  description = "Preview listener port inside Floci: always 100% green, so a candidate can be tested before it gets any user traffic."
  type        = number
  default     = 84
}

variable "alb_preview_host_port" {
  description = "Host port docker-compose publishes for the preview listener."
  type        = number
  default     = 8092
}

variable "alb_host_port" {
  description = "Host port docker-compose publishes for the ALB listener."
  type        = number
  default     = 8091
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

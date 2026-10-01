variable "region" {
  type    = string
  default = "us-east-1"
}

variable "floci_endpoint" {
  description = "Floci URL as seen from this machine (Terraform, AWS CLI)."
  type        = string
  default     = "http://localhost:4566"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-ec2"
}

variable "arch" {
  description = "CPU architecture of the local Docker host (arm64 on Apple Silicon, amd64 on CI runners). Picks the AMI and instance type; set by the Makefile."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "amd64"], var.arch)
    error_message = "arch must be arm64 or amd64."
  }
}

variable "use_systemd" {
  description = "false only with an AMI without systemd: UserData then starts processes directly."
  type        = bool
  default     = true
}

variable "alb_listener_port" {
  type    = number
  default = 80
}

variable "alb_host_port" {
  description = "Host port docker-compose publishes for the ALB listener."
  type        = number
  default     = 8088
}

variable "instance_aws_endpoint" {
  description = "Floci URL as seen from inside an instance. Empty = use the AWS_ENDPOINT_URL Floci injects."
  type        = string
  default     = ""
}

variable "db_host_override" {
  description = "Empty = use the RDS address Floci advertises. Set when instances must reach RDS another way (see FLOCI-NOTES.md)."
  type        = string
  default     = ""
}

variable "db_port_override" {
  type    = number
  default = 0
}

variable "alb_source_cidr" {
  description = "Empty = app SGs allow the ALB SG (real-AWS style). Set to a CIDR if Floci's ALB traffic does not carry the ALB SG identity."
  type        = string
  default     = ""
}

variable "ssh_cidr" {
  description = "Who may SSH to app instances. Wide open is fine locally; on real AWS use a bastion or SSM."
  type        = string
  default     = "0.0.0.0/0"
}

variable "build_dir" {
  type    = string
  default = "build"
}

variable "frontend_dist_dir" {
  type    = string
  default = "../../frontend/dist"
}

variable "floci_container" {
  description = "Name of the Floci container (docker compose project 'fullstack-devops', service 'floci')."
  type        = string
  default     = "fullstack-devops-floci-1"
}

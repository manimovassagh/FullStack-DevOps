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

variable "ami_id" {
  description = "Floci's Ubuntu 24.04 systemd AMI (arm64). Its image is not published, so `make ami` bakes it locally (see FLOCI-NOTES.md)."
  type        = string
  default     = "ami-ubuntu2404-cloud"
}

variable "instance_type" {
  description = "Graviton (arm64), matching the arm64 AMI."
  type        = string
  default     = "t4g.micro"
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
  default = "../../../frontend/dist"
}

variable "floci_container" {
  description = "Name of the Floci container (docker compose project 'fullstack-devops', service 'floci')."
  type        = string
  default     = "fullstack-devops-floci-1"
}

variable "on_floci" {
  description = "true for the local Floci stack. false on real AWS turns on what Floci can't emulate (encrypted root volumes)."
  type        = bool
  default     = true
}

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
  default     = "plant-ecs"
}

variable "image_tag" {
  description = "Tag of the backend and frontend images in ECR. `make images` pushes it; a new tag rolls both services."
  type        = string
}

variable "alb_listener_port" {
  description = "Listener port inside Floci. 81 so classic-ec2 (80) can run at the same time."
  type        = number
  default     = 81
}

variable "alb_host_port" {
  description = "Host port docker-compose publishes for the ALB listener."
  type        = number
  default     = 8089
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

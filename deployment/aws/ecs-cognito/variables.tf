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
  default     = "plant-cognito"
}

variable "image_tag" {
  description = "Tag of the backend and frontend images in ECR. `make images` pushes it; a new tag rolls both services."
  type        = string
}

variable "alb_listener_port" {
  description = "Listener port inside Floci. 88, the next free one, so every stage can run at the same time."
  type        = number
  default     = 88
}

variable "alb_host_port" {
  description = "Host port docker-compose publishes for the ALB listener."
  type        = number
  default     = 8096
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "on_floci" {
  description = "True while running against Floci: tokens are issued by Floci's URL and the refresh cookie is sent over plain HTTP. False on real AWS."
  type        = bool
  default     = true
}

variable "demo_users" {
  description = "Cognito users created for the demo (email => admin?). Never do this with real people."
  type        = map(object({ admin = bool }))
  default = {
    "alice@plant.example" = { admin = false }
    "bob@plant.example"   = { admin = false }
    "root@plant.example"  = { admin = true }
  }
}

variable "demo_password" {
  description = "Password of every demo user. A throwaway value for a local emulator, fine to be in git; use invitations on real AWS."
  type        = string
  default     = "Plant-Parent-2026!"
}

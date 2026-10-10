variable "region" {
  type    = string
  default = "us-east-1"
}

variable "floci_endpoint" {
  description = "This stage's own Floci as seen from this machine (see compose.yaml)."
  type        = string
  default     = "http://localhost:4572"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-accounts"
}

variable "image_tag" {
  description = "Tag of the backend image in ECR. `make images` pushes it; a new tag rolls the service."
  type        = string
}

variable "alb_listener_port" {
  description = "Listener port inside this stage's Floci. CloudFront (inside the same Floci) connects to it."
  type        = number
  default     = 80
}

variable "alb_host_port" {
  description = "Host port compose.yaml publishes for the ALB itself: only to show that skipping CloudFront gets 403."
  type        = number
  default     = 8099
}

variable "floci_port" {
  description = "Host port of this stage's Floci; CloudFront serves the app on it."
  type        = number
  default     = 4572
}

variable "local_hostname" {
  description = "On Floci the distribution gets this alias, so the app is at http://<hostname>:<floci_port> (*.localhost resolves to 127.0.0.1)."
  type        = string
  default     = "plant-accounts.localhost"
}

variable "on_floci" {
  description = "Floci-only workarounds (CloudFront alias, localhost ALB origin, open ALB security group, SPA error page). Set false on real AWS."
  type        = bool
  default     = true
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "demo_users" {
  description = "Demo users created in the pool (email → display name)."
  type        = map(object({ name = string }))
  default = {
    "alice@plant.example" = { name = "Alice" }
    "bob@plant.example"   = { name = "Bob" }
  }
}

variable "demo_password" {
  description = "Password of every demo user. Demo only: real users sign up and pick their own."
  type        = string
  default     = "Plant-Parent-2026!"
  sensitive   = true
}

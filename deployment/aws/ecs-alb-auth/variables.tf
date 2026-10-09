variable "region" {
  type    = string
  default = "us-east-1"
}

variable "floci_endpoint" {
  description = "This stage's own Floci as seen from this machine (see compose.yaml)."
  type        = string
  default     = "http://localhost:4569"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-ecs-alb-auth"
}

variable "image_tag" {
  description = "Tag of the backend and frontend images in ECR. `make images` pushes it; a new tag rolls both services."
  type        = string
}

variable "alb_listener_port" {
  description = "Listener port inside this stage's Floci (published as alb_host_port). Real AWS uses 443."
  type        = number
  default     = 80
}

variable "alb_host_port" {
  description = "Host port compose.yaml publishes for the ALB listener."
  type        = number
  default     = 8097
}

variable "on_floci" {
  description = "True on Floci: an HTTP listener (Floci has no ACM). False on real AWS: HTTPS, which ALB authentication requires."
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
  description = "Demo users created in the pool (email → settings)."
  type        = map(object({}))
  default = {
    "alice@plant.example" = {}
    "bob@plant.example"   = {}
  }
}

variable "demo_password" {
  description = "Password of every demo user. Demo only: real users are invited and pick their own."
  type        = string
  default     = "Plant-Parent-2026!"
  sensitive   = true
}

variable "cognito_domain_prefix" {
  description = "Hosted-UI domain prefix (<prefix>.auth.<region>.amazoncognito.com). Must be unique per region on real AWS."
  type        = string
  default     = "plant-ecs-alb-auth"
}

variable "certificate_arn" {
  description = "ACM certificate for the HTTPS listener on real AWS. Unused on Floci."
  type        = string
  default     = null
}

variable "public_url" {
  description = "Public origin of the app on real AWS (https://plants.example.com). The callback is <public_url>/oauth2/idpresponse."
  type        = string
  default     = null
}

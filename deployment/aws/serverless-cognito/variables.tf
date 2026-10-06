variable "region" {
  type    = string
  default = "us-east-1"
}

variable "floci_endpoint" {
  description = "This stage's Floci (compose.yaml), as seen from this machine."
  type        = string
  default     = "http://localhost:4568"
}

variable "floci_port" {
  description = "Host port of that Floci; the app is served on it."
  type        = number
  default     = 4568
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "plant-sls-auth"
}

variable "on_floci" {
  description = "Floci-only workarounds (CloudFront alias + localhost API origin, in-Floci endpoint URL). Set false on real AWS."
  type        = bool
  default     = true
}

variable "lambda_zip" {
  description = "The function package built by `make lambda` (a zip holding one file named bootstrap)."
  type        = string
  default     = "build/lambda.zip"
}

variable "lambda_architecture" {
  description = "arm64 or x86_64. Must match the binary in the zip; `make` picks the host's (Floci runs functions on the Docker host's architecture)."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.lambda_architecture)
    error_message = "lambda_architecture must be arm64 or x86_64."
  }
}

variable "release" {
  description = "Release label passed to the function. Changing it publishes a new Lambda version and moves the `live` alias (see `make rollout`)."
  type        = string
  default     = "initial"
}

variable "local_hostname" {
  description = "On Floci the distribution gets this alias, so the app is at http://<hostname>:4566 (*.localhost resolves to 127.0.0.1)."
  type        = string
  default     = "plant-auth.localhost"
}

variable "cognito_issuer_base" {
  description = "On Floci: the base URL Floci writes into the tokens' iss claim (its own address inside the container, port 4566). Not used on AWS."
  type        = string
  default     = "http://localhost:4566"
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

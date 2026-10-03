variable "project" {
  description = "Google Cloud project id."
  type        = string
  default     = "plant-parent"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "floci_endpoint" {
  description = "The Floci GCP emulator as seen from this machine (Terraform, curl)."
  type        = string
  default     = "http://localhost:4588"
}

variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "plant"
}

variable "image_tag" {
  description = "Tag of the three images (backend, frontend, gateway). `make images` builds it; a new tag creates new Cloud Run revisions."
  type        = string
}

variable "on_floci" {
  description = "Floci-only shortcuts (plain DATABASE_URL, emulator storage host, TCP to Cloud SQL). Set false on real Google Cloud."
  type        = bool
  default     = true
}

variable "emulator_host_in_network" {
  description = "How containers on the compose network reach the emulator's storage API (STORAGE_EMULATOR_HOST). Only used when on_floci."
  type        = string
  default     = "floci-gcp:4588"
}

variable "private_network_id" {
  description = "Self link of the VPC for a private Cloud SQL address (real Google Cloud only; needs private services access). Null keeps a public address."
  type        = string
  default     = null
}

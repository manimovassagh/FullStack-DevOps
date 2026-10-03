variable "location" {
  type    = string
  default = "eastus"
}

variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "plant"
}

variable "metadata_host" {
  description = "The Floci Azure emulator as seen from this machine."
  type        = string
  default     = "localhost:4577"
}

variable "image_tag" {
  description = "Tag of the three images (backend, frontend, gateway). `make images` builds it; a new tag creates a new Container Apps revision."
  type        = string
}

variable "on_floci" {
  description = "Floci-only shortcuts (container addresses looked up with docker, plain TCP to Postgres, MinIO instead of Blob). Set false on real Azure."
  type        = bool
  default     = true
}

variable "db_host" {
  description = "Floci only: the address of the PostgreSQL server's container (the Makefile looks it up after creating the server). On Azure the server's FQDN is used."
  type        = string
  default     = ""
}

variable "emulator_address" {
  description = "Floci only: the address of the emulator container, through which the gateway reaches the apps."
  type        = string
  default     = ""
}

variable "s3_address" {
  description = "Floci only: the address of the S3-compatible object store container."
  type        = string
  default     = ""
}

variable "media_bucket" {
  description = "Bucket for photos in the S3-compatible store."
  type        = string
  default     = "plant-media"
}

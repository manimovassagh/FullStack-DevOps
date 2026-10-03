# Every Google API call goes to the Floci GCP emulator. On real Google Cloud you would delete the
# custom endpoints and the fake token (use `gcloud auth application-default login`); the resources stay the same.
# Credentials: the Makefile exports GOOGLE_OAUTH_ACCESS_TOKEN=fake, which floci-gcp ignores.
provider "google" {
  project = var.project
  region  = var.region

  user_project_override = false

  storage_custom_endpoint          = "${var.floci_endpoint}/storage/v1/"
  iam_custom_endpoint              = "${var.floci_endpoint}/"
  iam_beta_custom_endpoint         = "${var.floci_endpoint}/v1/"
  secret_manager_custom_endpoint   = "${var.floci_endpoint}/v1/"
  cloud_run_v2_custom_endpoint     = "${var.floci_endpoint}/v2/"
  sql_custom_endpoint              = "${var.floci_endpoint}/sql/v1beta4/"
  service_usage_custom_endpoint    = "${var.floci_endpoint}/v1/"
  resource_manager_custom_endpoint = "${var.floci_endpoint}/v1/"

}

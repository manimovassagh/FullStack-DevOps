# User uploads (plant photos). The backend reads and writes it through the Cloud Storage client library.
resource "google_storage_bucket" "media" {
  name                        = "${var.name}-media-${var.project}"
  location                    = var.region
  force_destroy               = true # local learning stack; never on real data
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # floci-gcp does not store the uniform-access flag, so it would show as a change on every plan.
  lifecycle {
    ignore_changes = [uniform_bucket_level_access]
  }
}

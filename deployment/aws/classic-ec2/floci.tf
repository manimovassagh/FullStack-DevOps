# Floci-only plumbing — there is nothing like this on real AWS.
#
# Floci backs each VPC with a Docker network (floci-vpc-<port>-<region>-<vpc id>)
# and its ALB connects to targets on their VPC private IPs, but the Floci
# container itself is not attached to that network. Attach it so the ALB can
# reach the instances (see FLOCI-NOTES.md). Delete this file for real AWS.
resource "terraform_data" "floci_joins_vpc" {
  input = {
    container = var.floci_container
    network   = "floci-vpc-4566-${var.region}-${aws_vpc.main.id}"
  }

  provisioner "local-exec" {
    command = <<-EOT
      for i in $(seq 1 30); do docker network inspect "${self.input.network}" >/dev/null 2>&1 && break; sleep 2; done
      docker network connect "${self.input.network}" "${self.input.container}" 2>&1 | grep -v 'already exists' || true
      docker inspect -f '{{json .NetworkSettings.Networks}}' "${self.input.container}" | grep -q "${self.input.network}"
    EOT
  }

  provisioner "local-exec" {
    when       = destroy
    on_failure = continue
    command    = "docker network disconnect -f '${self.input.network}' '${self.input.container}'"
  }

  # Floci creates the VPC network when the first instance starts.
  depends_on = [aws_instance.backend, aws_instance.frontend]
}

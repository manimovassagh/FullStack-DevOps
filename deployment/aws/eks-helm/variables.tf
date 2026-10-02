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
  default     = "plant-eks-helm"
}

variable "kubernetes_version" {
  description = "EKS control-plane version. On Floci the k3s image (docker-compose) decides the real version."
  type        = string
  default     = "1.34"
}

variable "kubectl_allowed_cidrs" {
  description = "Who may reach the public Kubernetes API endpoint. On real AWS: your own IP/32 or office range."
  type        = list(string)
  default     = ["127.0.0.1/32"]
}

variable "alb_listener_port" {
  description = "Listener port inside Floci. 85: the other stages use 80-84."
  type        = number
  default     = 85
}

variable "alb_host_port" {
  description = "Host port docker-compose publishes for the ALB listener."
  type        = number
  default     = 8094
}

variable "node_ports" {
  description = "NodePorts of the Kubernetes Services (k8s/services.yaml); the ALB target groups forward to them."
  type        = map(number)
  default = {
    frontend = 30080
    backend  = 30081
  }
}

variable "on_floci" {
  description = "Skip what Floci 2.1.0 doesn't implement (EKS access entries). Set false on real AWS."
  type        = bool
  default     = true
}

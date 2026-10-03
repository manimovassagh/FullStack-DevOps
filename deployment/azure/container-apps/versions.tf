terraform {
  required_version = ">= 1.14"

  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    random  = { source = "hashicorp/random", version = "~> 3.7" }
  }
}

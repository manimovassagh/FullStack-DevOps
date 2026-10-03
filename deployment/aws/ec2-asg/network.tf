locals {
  # One entry per AZ; `n` picks the third octet offset for each tier.
  azs = {
    a = { az = "${var.region}a", n = 0 }
    b = { az = "${var.region}b", n = 1 }
  }
}

resource "aws_vpc" "main" {
  cidr_block           = "10.7.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

# Public tier: only the ALB and the NAT gateway live here.
resource "aws_subnet" "public" {
  for_each          = local.azs
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value.az
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 0 + each.value.n)
  tags              = { Name = "${var.name}-public-${each.key}", Tier = "public" }
}

# Private app tier: EC2 instances, reachable only through the ALB.
resource "aws_subnet" "app" {
  for_each          = local.azs
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value.az
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + each.value.n)
  tags              = { Name = "${var.name}-app-${each.key}", Tier = "app" }
}

# Private data tier: RDS only.
resource "aws_subnet" "db" {
  for_each          = local.azs
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value.az
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 20 + each.value.n)
  tags              = { Name = "${var.name}-db-${each.key}", Tier = "db" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.name }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# Private instances reach the internet (apt, AWS CLI download) through NAT.
# On Floci this is metadata only — Docker provides outbound access anyway.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.name}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public["a"].id
  tags          = { Name = var.name }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${var.name}-private" }
}

resource "aws_route_table_association" "app" {
  for_each       = aws_subnet.app
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "db" {
  for_each       = aws_subnet.db
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

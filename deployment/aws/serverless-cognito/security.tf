# One rule that matters: only the function's ENIs may reach Postgres.

resource "aws_security_group" "lambda" {
  name        = "${var.name}-lambda"
  description = "Lambda function ENIs: no inbound, outbound to Postgres and AWS APIs"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres, only from the function"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_lambda" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432

  # Floci reports the reference as "<account>/sg-…", which would show as a change on every plan.
  lifecycle {
    ignore_changes = [referenced_security_group_id]
  }
}

resource "aws_vpc_security_group_egress_rule" "lambda_all" {
  security_group_id = aws_security_group.lambda.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

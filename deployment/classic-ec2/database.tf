resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = [for s in aws_subnet.db : s.id]
}

# No special characters: the password goes straight into a postgres:// URL.
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_db_instance" "main" {
  identifier             = var.name
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  db_name                = "plant"
  username               = "plant"
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  skip_final_snapshot    = true
}

# The backend reads this at boot with its instance role; Terraform never puts
# the password into UserData.
resource "aws_secretsmanager_secret" "db" {
  name                    = local.db_secret_name
  recovery_window_in_days = 0 # allow immediate re-create after destroy
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db.result
    host     = var.db_host_override != "" ? var.db_host_override : aws_db_instance.main.address
    port     = var.db_port_override != 0 ? var.db_port_override : aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
  })
}

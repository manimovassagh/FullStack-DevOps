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
  storage_encrypted      = true
  skip_final_snapshot    = true
}

# The whole connection string in one secret: the backend task gets it as the
# DATABASE_URL environment variable from a Kubernetes Secret that `make secrets` syncs from here.
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.name}/database-url"
  recovery_window_in_days = 0 # allow immediate re-create after destroy
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=disable"
}

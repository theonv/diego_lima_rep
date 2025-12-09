-- Garantir que o banco de dados está criado
CREATE DATABASE IF NOT EXISTS sql_profdiegolima_com_br;
USE sql_profdiegolima_com_br;

-- Tabela Enrollment conforme schema.prisma
CREATE TABLE IF NOT EXISTS Enrollment (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  cpf VARCHAR(11) NOT NULL UNIQUE,
  phone VARCHAR(255) NOT NULL,
  birthDate DATETIME,
  modality VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  paymentId VARCHAR(255),
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_cpf (cpf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

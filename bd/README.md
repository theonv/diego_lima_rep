# Docker MySQL Setup

Este diretório contém a configuração Docker para o banco de dados MySQL local.

## Requisitos
- Docker instalado
- Docker Compose instalado

## Como usar

### Iniciar o container
```bash
cd bd
docker-compose up -d
```

### Parar o container
```bash
docker-compose down
```

### Acessar o MySQL
```bash
docker-compose exec mysql mysql -u sql_profdiegolima_com_br -p6c005f5e006d1 sql_profdiegolima_com_br
```

### Verificar logs
```bash
docker-compose logs -f mysql
```

## Configuração

- **Host**: localhost
- **Port**: 3306
- **Database**: sql_profdiegolima_com_br
- **Username**: sql_profdiegolima_com_br
- **Password**: 6c005f5e006d1
- **Root Password**: rootpassword

## Ambiente do Codespace

Para usar em seu Codespace (https://solid-engine-7vp56565ww49crv79.github.dev/), você pode:

1. Iniciar o container Docker normalmente
2. Usar a DATABASE_URL do arquivo `.env.docker` para desenvolvimento local
3. O MySQL estará acessível via `localhost:3306` dentro do Codespace

## Migração com Prisma

Após o container estar rodando, execute no diretório `/api`:

```bash
# Aplicar as migrações existentes
npx prisma migrate deploy

# Ou criar nova migração
npx prisma migrate dev --name seu_nome
```

## Arquivos

- `docker-compose.yml` - Configuração do container Docker
- `init.sql` - Scripts de inicialização do banco de dados
- `.env.docker` - Variáveis de ambiente para desenvolvimento local

# Backend

Esta aplicação conterá o servidor Express e os módulos do monólito modular. O worker também executará no backend na v1.

A aplicação pode depender dos contratos públicos de `@copilot-leads/shared`. Os contratos não dependem desta aplicação. Os tipos do Node estão habilitados apenas neste ambiente.

`src/index.ts` continua como ponto de entrada vazio; o servidor HTTP e as regras de negócio serão construídos nas próximas entregas. A etapa 4.2 acrescentou configuração e comandos de infraestrutura executáveis separadamente.

## Banco de dados

- `src/config/database.ts`: valida as variáveis `POSTGRES_*` com Zod e retorna a configuração tipada.
- `src/infrastructure/database/pool.ts`: cria o pool `pg`, sem conexão global aberta ao importar o arquivo.
- `src/scripts/check-database.ts`: consulta banco e usuário pela conexão da aplicação e encerra o pool.
- `src/scripts/migrate-database.ts`: aplica migrações SQL com `node-pg-migrate` e mantém o histórico em `public.pgmigrations`.
- `migrations/`: diretório das futuras migrações SQL. `.gitkeep` apenas permite versionar o diretório vazio.

Na raiz do monorepo, execute `npm run db:check` para testar a conexão, `npm run db:migrate` para aplicar migrações pendentes e `npm run check` para verificar tipos, compilação e testes. Os comandos de banco compilam a API e carregam o `.env` da raiz com a opção nativa `--env-file` do Node. Eles exigem o PostgreSQL em execução. O migrador cria sua tabela de histórico mesmo quando não há arquivos de migração.

Os tipos do banco e as consultas permanecerão no backend. Os contratos consumidos pelo painel continuam em `packages/shared`. Consulte o [guia da etapa 4.2](../../docs/10-etapa-4-acesso-ao-banco.md) para revisar a entrega.

O campo `exports: {}` declara que esta aplicação não oferece uma interface de pacote para importação pelo dashboard. As fronteiras entre os futuros módulos também precisarão ser respeitadas no código e na revisão.

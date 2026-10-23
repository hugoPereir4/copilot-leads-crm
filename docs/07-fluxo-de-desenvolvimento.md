# Copiloto de Leads WhatsApp — 7. Fluxo de Desenvolvimento e Revisão

Decisões confirmadas em 23/10/2026.

## 1. Branches e entregas

- **`main`:** contém o estado revisado e funcionando do projeto. Cada fase deve cumprir os critérios aplicáveis à entrega, mesmo antes de a v1 estar completa.
- **Uma branch por entrega pequena:** reunir mudanças relacionadas a um objetivo que o autor consiga revisar sozinho. Uma entrega pode alterar API, dashboard, contratos e documentação na mesma branch.
- **Commits por mudança lógica:** manter propósito claro, evitando misturar alterações independentes.
- **Integração na `main`:** depois da revisão individual do autor e das verificações pertinentes à entrega.

Exemplos de nomes de branch: `feat/recepcao-direta`, `fix/lead-duplicado` e `chore/base-monorepo`. São nomes ilustrativos; o compromisso principal é uma branch por entrega pequena.

## 2. Conventional Commits

As mensagens seguem a estrutura `tipo(escopo opcional): descrição`. O escopo identifica a área afetada quando isso ajuda a entender a mudança.

Exemplos:

```text
feat(conversas): encaminhar solicitação à recepção
fix(leads): impedir dois atendimentos abertos por contato
docs(arquitetura): explicar as fronteiras entre módulos
chore(repo): configurar os pacotes do monorepo
```

Usar `feat` para funcionalidades e `fix` para correções. Tipos como `docs`, `test`, `refactor`, `chore`, `build` e `ci` podem descrever as demais mudanças. Quebras de compatibilidade devem ser sinalizadas conforme a especificação, com `!` ou o rodapé `BREAKING CHANGE`.

Referência: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/).

## 3. Acompanhamento do aprendizado

Cada entrega deve conectar a implementação às decisões de arquitetura: responsabilidade do módulo, localização da regra, interfaces, direção das dependências, alternativas e custo da escolha. A forma de trabalho está detalhada na seção **Forma de trabalho para estudar arquitetura** do [documento de arquitetura](02-decisoes-de-arquitetura.md).

O autor está estudando Express na faculdade. Explicar rotas, routers, middlewares, requisições, respostas e tratamento de erros conforme forem usados, relacionando o framework à separação de responsabilidades da D2 e à escolha da D20.

Antes de usar Docker, avisar, explicar as operações e indicar a documentação oficial, conforme a preferência registrada na D10. Trabalhar em blocos pequenos para permitir acompanhamento e revisão.

## 4. Decisões conforme a entrega

A base de organização está definida: monólito modular, monorepo com npm workspaces, TypeScript estrito, Express, Zod e PostgreSQL local com Docker Compose. As demais escolhas serão discutidas antes da entrega que precisar delas, com explicação das alternativas e dos custos. Não é necessário concluir todas para preparar a estrutura inicial.

| Entrega | Decisão a resolver antes dela |
|---|---|
| Preparação da base | Versões compatíveis, scripts e ferramentas mínimas de qualidade |
| Persistência | Acesso ao banco e migrações |
| Menu e perfil da clínica | Armazenamento da configuração, serviços, valores, horários e textos fictícios |
| Integração de IA | Provedor, modelo, orçamento, limites e critérios de revisão |
| Login do painel | Sessão e autenticação |
| Atualizações do painel | SSE ou polling |

**Primeira entrega da etapa 3 implementada, pronta para revisão:** estrutura dos workspaces `apps/api`, `apps/web` e `packages/shared`, configuração TypeScript estrita e scripts básicos para verificar os pacotes. Os critérios de revisão são a responsabilidade de cada pacote, a direção das dependências e o funcionamento das verificações configuradas. A entrega está na branch `chore/base-monorepo`, conforme a seção 1; instalações, configurações e roteiro de revisão estão no [documento 8](08-etapa-3-base-do-monorepo.md).

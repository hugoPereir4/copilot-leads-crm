# Contratos compartilhados

## O que é

`@copilot-leads/shared` contém só **tipos TypeScript públicos** das requisições e respostas HTTP usadas pela API e pelo painel. Não usa Zod e não tem dependências: o `package.json` não declara `dependencies`, e os arquivos de `src/` só exportam tipos (`export type`). A validação em execução, com os schemas Zod, fica no backend (D21).

## Módulos exportados

`src/index.ts` reexporta:

| Módulo | Tipos |
|---|---|
| `auth` | `Attendant`, `LoginRequest`, `LoginResponse` |
| `demo` | `DemoConversation`, `DemoMessage` |
| `human-handoff` | `HumanHandoffReceipt` |
| `lead-closure` | `LeadClosureOutcome`, `LeadClosureReceipt` |
| `qualification` | `LeadQualification`, `QualificationSource` |

`DemoConversation` usa `LeadQualification` internamente, no campo `lead.qualification`.

## Quem usa

Importações encontradas com `grep` em `apps/api/src` e `apps/web/src`:

- **API:** `DemoConversation`, `DemoMessage`, `HumanHandoffReceipt`, `LeadClosureOutcome`, `LeadClosureReceipt`, `LeadQualification` e `QualificationSource`. Estão no read model do painel, nos casos de uso e stores de leads e no contrato de qualificação.
- **Web:** `Attendant`, `DemoConversation`, `DemoMessage`, `HumanHandoffReceipt`, `LeadClosureOutcome`, `LeadClosureReceipt` e `LoginRequest`, em `src/demo.ts` e `src/login.ts`.

`LoginResponse` é exportado, mas hoje nenhuma das duas aplicações o importa. A API tem o próprio tipo de atendente em `modules/auth/contracts/attendant.ts`.

## Como compilar

- `npm run build --workspace=@copilot-leads/shared` executa `tsc -p tsconfig.json` e gera JavaScript, declarações (`.d.ts`) e source maps de declaração em `dist/`. O `exports` do `package.json` aponta para `dist/index.js` e `dist/index.d.ts`.
- `npm run typecheck --workspace=@copilot-leads/shared` só verifica os tipos.
- **Ordem:** as aplicações leem as declarações em `dist/`, então o pacote precisa estar compilado antes delas. Por isso o `npm run typecheck` da raiz compila primeiro `shared` e só depois verifica os tipos de todos os workspaces. O `npm run build` da raiz segue a ordem dos workspaces (`packages/shared`, `apps/api`, `apps/web`).

## Regra

O pacote não depende de `apps/api` nem de `apps/web`: o `package.json` dele não declara nenhuma dependência. A dependência é só no sentido contrário: `apps/api` e `apps/web` declaram `@copilot-leads/shared` (D19). Integrações, regras de atendimento, variáveis de ambiente e acesso ao banco pertencem ao backend.

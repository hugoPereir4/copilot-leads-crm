# Contratos compartilhados

Este pacote conterá schemas Zod e tipos públicos de requisições, respostas e eventos usados pela API e pelo dashboard.

Ele não depende de `apps/api` ou `apps/web`. Integrações, regras de atendimento, variáveis de ambiente e acesso ao banco pertencem ao backend.

Na etapa 3, `src/index.ts` apenas marca a entrada do pacote. A compilação gera JavaScript e declarações de tipos em `dist`, referenciados por `exports` no `package.json`.

O pacote é compilado antes das aplicações, para que os consumidores encontrem sua interface pública. As funções e os contratos reais serão adicionados nas respectivas entregas.

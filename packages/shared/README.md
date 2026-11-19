# Contratos compartilhados

Este pacote contém só tipos TypeScript públicos das respostas e requisições HTTP usadas pela API e pelo dashboard: `auth`, `demo`, `human-handoff`, `lead-closure` e `qualification`. Não usa Zod nem tem dependências; os schemas Zod de validação ficam no backend.

Ele não depende de `apps/api` ou `apps/web`. Integrações, regras de atendimento, variáveis de ambiente e acesso ao banco pertencem ao backend.

`src/index.ts` reexporta esses tipos. A compilação gera JavaScript e declarações de tipos em `dist`, referenciados por `exports` no `package.json`.

O pacote é compilado antes das aplicações, para que os consumidores encontrem sua interface pública. Novos contratos entram aqui quando a API e o painel passam a compartilhá-los.

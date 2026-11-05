# Etapa 4.5 — Migração de mensagens

Preparada em 05/11/2026 na branch `feat/messages-migration`, sobre a entrega de conversas revisada e enviada ao remoto. Esta entrega prepara apenas a tabela `messages`, seus testes e documentação. Não foram instaladas dependências nem alterados `.env` ou credenciais.

**Validação:** `npm run check` passou na tipagem dos três pacotes, compilação e seis testes de configuração. `npm run test:integration` passou em 30 registros: oito cenários de contatos, nove de conversas, dez de mensagens e três agrupadores. A aplicação e a reversão da nova migração ocorreram somente em banco descartável; `npm run db:migrate` não foi executado no banco do projeto.

## 1. Ordem de revisão

| Ordem | Arquivo | Responsabilidade |
|---|---|---|
| 1 | [1793750402000_create_messages.sql](../apps/api/migrations/1793750402000_create_messages.sql) | Definir campos, vínculo à conversa, unicidade, índice de histórico e reversão |
| 2 | [messages-migration.integration.test.ts](../apps/api/src/infrastructure/database/messages-migration.integration.test.ts) | Preparar as dependências e testar o SQL em banco descartável |
| 3 | [package.json da API](../apps/api/package.json) | Acrescentar a suíte de mensagens ao comando explícito de integração |
| 4 | [modelagem](04-modelagem-de-dados.md) | Conferir a correspondência entre SQL, tabelas e DBML |

A ordem das migrações é `contacts → conversations → messages`. A chave estrangeira de mensagens exige conversas já existentes; o prefixo numérico mantém essa ordem. Os arquivos das duas migrações anteriores e seus testes permanecem iguais.

## 2. Campos e escolhas

| Campo | Definição | Finalidade |
|---|---|---|
| `id` | UUID obrigatório, padrão `gen_random_uuid()` | Identificador interno da mensagem |
| `conversation_id` | UUID obrigatório, FK | Ciclo de atendimento ao qual pertence |
| `provider`, `external_id` | Textos obrigatórios e não vazios após `btrim` | Identificação da mensagem na integração |
| `direction` | Texto obrigatório com CHECK | `entrada` ou `saida` |
| `sender_type` | Texto obrigatório com CHECK | `contato`, `bot` ou `atendente` |
| `kind` | Texto obrigatório com CHECK | `texto`, `audio` ou `outro` |
| `body` | Texto, podendo ser nulo | Conteúdo textual disponível |
| `raw_payload` | JSONB, podendo ser nulo | Payload original quando disponível |
| `created_at` | Data com fuso obrigatória, padrão `now()` | Instante de persistência no sistema |

`kind` complementa a tabela planejada com a distinção já existente no contrato de mensagem normalizada do documento 5. A V1 registra formatos não textuais e os ignora no processamento. Essa coluna não implementa download, transcrição ou tratamento de mídia.

Os três conjuntos fechados usam texto com `CHECK`, seguindo a escolha da migração de conversas. Não há padrão para direção, remetente ou tipo: o futuro adapter precisa classificá-los explicitamente. `body` e `raw_payload` podem ser nulos; a entrada ainda precisará validar o texto que realmente será processado. Não há restrição de formato do JSON por provedor no banco, nem normalização automática de seus identificadores. `btrim` verifica vazio e espaços comuns nas pontas; não substitui a validação completa da entrada.

`created_at` não substitui o horário de origem informado por um provedor. Se o adapter precisar preservar esse horário em uma coluna para consultas, isso será definido em outra entrega. Nesta etapa o payload pode preservá-lo como parte do original.

## 3. Garantias do banco e limites da D5

`messages_conversation_id_fkey` exige uma conversa existente e usa `ON DELETE RESTRICT`. Uma conversa com mensagens não pode ser apagada enquanto esse vínculo existir. A reversão remove somente `messages`, sem `CASCADE`, preservando contatos e conversas. Reverter esta migração destrói as mensagens dessa tabela; o teste só faz isso no banco criado pela própria suíte.

`messages_provider_external_id_key` impõe unicidade ao par `(provider, external_id)` em toda a tabela. O mesmo par não pode ser inserido de novo, mesmo apontando para outra conversa. Outro provedor pode usar o mesmo ID externo. O identificador externo também é obrigatório nos registros de saída; o futuro adapter simulado precisará fornecê-lo, e a integração real definirá como obtê-lo.

Essa restrição participa da idempotência, mas ainda não implementa o comportamento completo de reenvios. Hoje uma duplicata gera uma violação de unicidade; não existe caso de uso ou endpoint para interpretá-la. Na futura recepção, o sistema deverá reconhecer o conflito desse par, preservar a mensagem original e evitar duplicar jobs ou outros efeitos. Não se deve tratar qualquer erro de banco como se fosse uma duplicata.

`messages_conversation_created_at_idx`, em `(conversation_id, created_at)`, apoia consultas do histórico por conversa e data. Não impõe uma ordem automática aos resultados: a consulta precisará usar `ORDER BY` e definir desempate quando necessário. A avaliação de desempenho dependerá das consultas futuras.

## 4. Testes e isolamento

A suíte segue o padrão das entregas anteriores: aceita apenas host local, cria seu próprio banco `copilot_messages_test_<UUID hexadecimal>` e aplica primeiro contatos e conversas. Depois aplica e reverte apenas mensagens, selecionada pelo nome. Usa dados sintéticos e não lê mensagens de `copilot_leads`.

Os dez cenários verificam:

1. Aplicação na ordem das dependências e registro das três migrações.
2. UUID e data padrão, texto e payload JSON preservados.
3. Campos obrigatórios de vínculo, identificação e classificação.
4. Rejeição de conversa inexistente e proteção contra apagar conversa com mensagens.
5. Valores válidos de direção, remetente e tipo, rejeição dos inválidos e campos opcionais nulos.
6. Provedor e ID externo vazios ou com espaços comuns.
7. Duplicatas no mesmo provedor, inclusive em outra conversa, sem alterar a original; mesmo ID aceito em outro provedor.
8. Duas inserções concorrentes resultando em apenas uma mensagem.
9. Reexecução sem reaplicar migração ou alterar o histórico existente.
10. Índice de histórico criado, reversão somente de mensagens, dependências preservadas e reaplicação.

No `finally`, o pool é encerrado e o banco descartável só é removido se sua criação tiver sido confirmada. Cada suíte usa um nome próprio gerado internamente. A execução conjunta completou com sucesso, incluindo a limpeza desses bancos.

Para repetir as verificações na raiz:

```powershell
npm run check
npm run test:integration
```

O primeiro comando não conecta ao banco. O segundo exige o PostgreSQL local em execução e permissão para criar e remover os bancos de teste. Ele não equivale a executar `db:migrate` no banco do projeto.

## 5. Relação com o monólito modular e próxima entrega

O SQL é um detalhe de persistência do backend. Esta etapa não cria rotas, adapters, repositórios ou regras de processamento; esses componentes serão implementados quando houver um fluxo que os use. Tipos internos da tabela não foram colocados em `packages/shared`.

Ao construir a recepção, o caso de uso dependerá de contratos próprios; a infraestrutura executará o SQL e reconhecerá conflitos específicos. A regra de negócio não deverá importar `pg` ou Express. Essa separação segue as camadas da D2.

A próxima entrega pequena é a migração de `jobs`, que depende de mensagens. Só depois, no fluxo de recepção, será implementada a gravação de mensagem e job na mesma transação e no mesmo cliente reservado do pool, conforme D3/D4/D22. Esta entrega ainda não demonstra essa atomicidade.

Após a revisão do autor, `npm run db:migrate` poderá aplicar a migração pendente ao banco configurado no `.env`. Não executar esse comando antes da revisão desta entrega.

Referências oficiais: [restrições e chaves estrangeiras](https://www.postgresql.org/docs/18/ddl-constraints.html) e [códigos de erro SQLSTATE](https://www.postgresql.org/docs/18/errcodes-appendix.html).

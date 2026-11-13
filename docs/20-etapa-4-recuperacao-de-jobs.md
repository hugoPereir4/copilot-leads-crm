# Etapa 4.12 — Recuperação de jobs interrompidos

Preparada em 13/11/2026 na branch `feat/job-recovery`, sobre a etapa 4.11 revisada e enviada ao GitHub. Esta entrega acrescenta a operação interna de recuperação de reservas expiradas, sem iniciar consumo automático da fila.

**Validação executada após a complementação da revisão:** `npm run check` passou em tipos, compilação e 59 registros de testes sem banco. `npm run test:integration` passou em 101 registros, com zero falhas e zero ignorados. A etapa acrescenta três testes sem banco e dezesseis cenários de integração, além do agrupador da suíte. Os dois cenários adicionais verificam o lote padrão e a fronteira exata, descritos na seção 6.

Consultas de leitura antes e depois da integração confirmaram as mesmas contagens e hashes de `contacts`, `conversations`, `messages`, `jobs` e `pgmigrations` no banco do projeto. Não restaram bancos descartáveis. Não foram instaladas dependências, criadas migrações ou alteradas credenciais. As alterações desta etapa ficam locais para revisão, sem commit, push ou merge.

## 1. Problema resolvido

Se a aplicação parar depois de reservar um job e antes de concluir ou registrar sua falha, ele permanece em `processando`. A reserva comum considera apenas `pendente`, portanto esse job não seria executado novamente.

A recuperação identifica reservas antigas pelo `locked_at` e permite outra tentativa, respeitando o limite da linha atual. O registro e o vínculo à mensagem são preservados.

## 2. Ordem de revisão por dependência

Os caminhos de código abaixo pertencem a `apps/api/src/modules/jobs`.

| Ordem | Arquivo | Responsabilidade e pontos de revisão |
|---|---|---|
| 1 | [application/job-recovery.ts](../apps/api/src/modules/jobs/application/job-recovery.ts) | Definir a porta, opções e contagens retornadas. Separar recuperação das portas de reserva e finalização |
| 2 | [application/recover-expired-jobs.ts](../apps/api/src/modules/jobs/application/recover-expired-jobs.ts) | Solicitar o tipo suportado com prazo de 120 segundos e lote de 100. Centralizar os parâmetros técnicos sem SQL, timers ou relógio da aplicação |
| 3 | [application/recover-expired-jobs.test.ts](../apps/api/src/modules/jobs/application/recover-expired-jobs.test.ts) | Conferir os parâmetros enviados, resultado vazio e propagação de falhas com substitutos da persistência |
| 4 | [infrastructure/postgres-job-queue.ts](../apps/api/src/modules/jobs/infrastructure/postgres-job-queue.ts) | Revisar o novo `recoverExpired`: validação defensiva, seleção limitada, expiração pelo relógio do banco, bloqueio e atualização atômica. Os métodos anteriores foram preservados |
| 5 | [infrastructure/postgres-job-recovery.integration.test.ts](../apps/api/src/modules/jobs/infrastructure/postgres-job-recovery.integration.test.ts) | Conferir estados persistidos, limites, ordenação, concorrência, reservas antigas, rollback e isolamento das fixtures |
| 6 | [package.json da API](../apps/api/package.json) | Confirmar a inclusão dos testes novos nos comandos existentes, sem alteração das dependências |
| 7 | READMEs, [fluxo](03-fluxo-e-ciclo-de-vida.md), [modelagem](04-modelagem-de-dados.md), [histórico](07-fluxo-de-desenvolvimento.md) e [guia anterior](19-etapa-4-finalizacao-de-jobs.md) | Conferir a evolução das entregas e distinguir a operação disponível de sua execução periódica ainda pendente |

## 3. Responsabilidades no monólito modular

`JobRecovery` é uma porta separada de `JobQueue` e `JobLifecycle`. Um consumidor que apenas reserva ou finaliza continua com sua interface anterior. Os substitutos usados nos testes dessas operações não precisam implementar métodos novos.

`recoverExpiredJobs` define o tipo de tarefa e os parâmetros iniciais. `PostgresJobQueue` implementa as três portas usando o mesmo acesso ao PostgreSQL. A infraestrutura localiza e atualiza as linhas elegíveis em uma única instrução; o caso de uso recebe somente as contagens `requeued` e `failed`.

A aplicação depende de contratos, sem importar `pg`, Express ou mensagens do simulador. SQL e bloqueios permanecem na infraestrutura. Os contratos são internos ao backend e não foram acrescentados a `packages/shared`. Não há ligação desta operação com `src/index.ts`, rota HTTP ou temporizador nesta entrega.

## 4. Regras de expiração e recuperação

Os parâmetros iniciais ficam em `recover-expired-jobs.ts`:

- Prazo da reserva: **120 segundos** desde `locked_at`.
- Lote máximo solicitado pelo caso de uso: **100 jobs** por chamada.
- Tipo recuperado: **`processar_mensagem`**.

Uma reserva é elegível quando `status = 'processando'` e `locked_at <= CURRENT_TIMESTAMP - intervalo`. O instante de referência pertence à transação da consulta no PostgreSQL. `run_at` não determina a expiração: ele representa o agendamento da próxima reserva.

| Condição da linha expirada | Resultado |
|---|---|
| `attempts < max_attempts` | `pendente`, `run_at = CURRENT_TIMESTAMP`, `locked_at = NULL` |
| Limite de tentativas atingido | `falhou`, preservando `run_at`, com `locked_at = NULL` |

Nos dois casos, `last_error` recebe o código fixo `processing_reservation_expired`. Não são armazenados textos de exceção ou dados da pessoa. ID, mensagem, contador, máximo de tentativas e data de criação permanecem iguais.

O job recuperado com saldo fica disponível imediatamente. Ele já passou pelo prazo de expiração; não se soma outra espera de 5 a 60 segundos nesta operação. A política de retry da etapa 4.11 continua inalterada para falhas transitórias explicitamente registradas pelo processador.

O contador **não aumenta na recuperação**. A próxima chamada de reserva o incrementa e preenche um novo `locked_at`. Com três tentativas totais, uma interrupção na tentativa 1 permite reservar a 2; uma interrupção na tentativa 3 encerra o job como `falhou`.

A infraestrutura também protege chamadas diretas: `timeoutSeconds` deve ser um inteiro positivo seguro, e `batchSize`, um inteiro entre 1 e 1000. Valores inválidos lançam `RangeError` antes de consultar o banco. O teto do lote evita uma chamada que altere uma quantidade ilimitada de registros; não representa garantia de custo constante da busca.

## 5. Concorrência e reservas antigas

Uma CTE seleciona os candidatos por `locked_at`, `created_at` e `id`, com `LIMIT` e `FOR UPDATE SKIP LOCKED`. O `UPDATE ... FROM ... RETURNING` usa essas linhas na mesma instrução e transação implícita.

Linhas já bloqueadas por outra operação são puladas. Uma chamada posterior poderá recuperá-las depois que o bloqueio for liberado, se ainda satisfizerem a condição. Assim, um resultado vazio não significa necessariamente que não exista nenhum job expirado: pode haver reservas momentaneamente bloqueadas. A ordenação vale entre candidatos disponíveis, sem promessa de ordem global estrita.

Referências oficiais: [SELECT e bloqueios no PostgreSQL 18](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE) e [reavaliação de condições em Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED).

Se uma conclusão ou falha definitiva vencer a disputa, a recuperação não sobrescreve esse resultado. Se a recuperação vencer, a finalização antiga deixa de encontrar `processando`. Depois da nova reserva, o contador maior continua impedindo a tentativa anterior de atualizar a linha. Nenhuma contagem é zerada para reutilizar o job.

### Política de expiração confirmada na revisão

**A expiração torna o job elegível para recuperação, mas não invalida automaticamente sua tentativa.** Após os 120 segundos, `complete()` e `fail()` continuam autorizados enquanto o status permanecer `processando` e o contador corresponder à tentativa recebida. Portanto, uma conclusão ou falha tardia pode vencer a recuperação. Esses métodos não aplicam expiração estrita.

Se a recuperação alterar o estado primeiro, a tentativa antiga retorna `reserva_desatualizada`. Depois de uma nova reserva, a proteção por `id + attempts`, junto ao estado `processando`, continua impedindo finalizações da tentativa anterior. A recuperação preserva o contador; a nova reserva o incrementa.

**Consequências para o futuro worker:** atingir o prazo não cancela uma execução, não interrompe uma chamada externa e não prova que o executor anterior parou. O worker deverá tratar `reserva_desatualizada` como ausência de autorização para finalizar aquela tentativa e não informar conclusão confirmada. Também precisará definir tempos máximos de processamento e encerramento coordenado; a recuperação poderá permitir uma nova execução enquanto a antiga ainda termina. A prevenção de efeitos externos duplicados continua exigindo idempotência própria.

Esta entrega não inclui renovação periódica da reserva. Antes de ativar o worker, o tempo máximo do processamento deverá ser compatível com esse prazo, incluindo chamadas externas e suas repetições. Os 120 segundos são um parâmetro inicial para revisão, sem evidência de duração de um processador real ainda inexistente.

A proteção da fila também não desfaz ou impede sozinha efeitos externos duplicados. Ordenação por conversa, envio único da abertura e idempotência dos efeitos continuam necessários antes do consumo real.

## 6. Cenários verificados

Os três testes sem banco verificam parâmetros, preservação do resultado e propagação de indisponibilidade.

Os dezesseis cenários de integração verificam:

1. Ausência de jobs expirados com contagens zero.
2. Lote com saldo e limite esgotado, preservação de campos e nova reserva imediatamente disponível.
3. Exclusão de reservas recentes, futuras, outros tipos e outros estados.
4. Expiração por `locked_at` e relógio do banco, independente de `run_at`.
5. Repetição sem reaplicar mudanças.
6. Lote unitário e ordenação pelos três campos de desempate.
7. Opções inválidas sem chamadas SQL nem alteração persistida.
8. Duas recuperações concorrentes sem contabilizar a mesma linha duas vezes.
9. Recuperações concorrentes com lotes unitários recuperando registros distintos.
10. Linha bloqueada pulada e recuperada depois de sua liberação.
11. Finalizações antigas rejeitadas antes e depois da nova reserva; a reserva atual continua funcionando.
12. Conclusão concorrente com recuperação preservando a transição vencedora.
13. Falha definitiva concorrente com recuperação preservando a transição vencedora.
14. Erro após o update desfazendo todo o lote, com nova chamada válida após remover o trigger.
15. Lote padrão: 101 jobs expirados com saldo, exatamente 100 recuperados na primeira chamada e um na segunda, preservando todos os contadores nas duas chamadas. O registro que sobra na primeira chamada permanece integralmente igual ao original, em `processando`.
16. Fronteira exata: reservas um microssegundo antes de atingir o prazo, exatamente nos 120 segundos e um microssegundo após o prazo. A igualdade é elegível; somente a reserva que ainda não atingiu o prazo permanece em `processando`.

O teste da fronteira usa um pool exclusivo de uma conexão, sem consumidores concorrentes, para executar `BEGIN`, o ajuste das fixtures e o método real de recuperação sequencialmente na mesma conexão. `CURRENT_TIMESTAMP` permanece no instante de início dessa transação. Os `locked_at` são definidos por SQL como esse instante menos 120 segundos, com deslocamentos de -1, 0 e +1 microssegundo. As comparações de posição são feitas no PostgreSQL, sem converter os valores para `Date`, que perderia a precisão de microssegundos.

Assim, a reserva no limite verifica o operador inclusivo `<=`, e a reserva a um microssegundo de expirar continua protegida até numa segunda chamada. Não há `setTimeout`, espera artificial, relógio do Node ou substituição da consulta de produção. Um `ROLLBACK` encerra o cenário e o pool exclusivo é fechado no `finally`. Esse comportamento do relógio está documentado em [data e hora atuais no PostgreSQL 18](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

A suíte cria `copilot_job_recovery_test_<UUID>` exclusivamente no PostgreSQL local e aplica nele as quatro migrações existentes. TRUNCATE, ajustes de datas e trigger de falha atuam somente no banco criado pela suíte. As fixtures usam dados sintéticos e datas calculadas no banco, sem aguardar dois minutos ou usar timers para simular expiração.

Ao terminar, as conexões são fechadas e somente o banco criado pela execução é removido. As oito suítes passaram com 101 registros: os 84 anteriores e os dezesseis cenários novos, mais seu agrupador. As contagens e hashes do banco do projeto permaneceram iguais, e nenhum banco descartável restou.

A execução também registrou um aviso de conexão ociosa interrompida na suíte existente de reivindicação, que terminou aprovada. Não houve falhas, testes cancelados ou ignorados. A conferência posterior confirmou a remoção dos bancos descartáveis; o aviso foi registrado sem alterações fora do escopo desta revisão.

## 7. Comandos para sua revisão

Na raiz do projeto:

```powershell
npm run check
npm run test:integration
```

O primeiro executa tipos, compilação e os 59 registros sem banco. O segundo exige o PostgreSQL local disponível e permissão para criar bancos descartáveis; são esperados 101 registros aprovados. Não é necessário iniciar a API ou executar `npm run db:migrate` nesta entrega.

O PostgreSQL local está no Docker. Mantenha o Docker Desktop aberto; se o serviço estiver parado, o comando abaixo o inicia usando o volume existente:

```powershell
docker compose up -d --wait --wait-timeout 120 postgres
```

Ele não executa as migrações da aplicação. Consulte a [documentação oficial do Compose](https://docs.docker.com/compose/intro/compose-application-model/) e o [guia local do projeto](09-etapa-4-postgres-local.md) para revisar serviço, container e volume.

Para verificar somente os testes novos, após compilar:

```powershell
npm run build --workspace=@copilot-leads/api
node --test apps/api/dist/modules/jobs/application/recover-expired-jobs.test.js
node --env-file=.env --test apps/api/dist/modules/jobs/infrastructure/postgres-job-recovery.integration.test.js
```

## 8. Próxima parte

Preparar o processador real e a configuração de seu tempo máximo, definir ordenação por conversa e idempotência dos efeitos e então ligar reserva, processamento, finalização e recuperação ao loop do worker. O encerramento coordenado deverá impedir novas reservas e tratar o trabalho em andamento. Não ativar um handler vazio que consuma e conclua os jobs existentes.

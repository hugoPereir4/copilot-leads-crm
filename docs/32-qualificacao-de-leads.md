# Qualificação administrativa — simulada e Gemini opcional

Branch `feat/lead-qualification-core`, baseada em `feat/lead-closure` (`5717618`). Fluxo vertical, sem autenticação, WhatsApp real, SSE, agendamento automático ou decisões clínicas.

## Arquitetura e garantias

O menu/decisor existente continua determinístico. Abertura e opções 1/2/3 preservam seus significados; opção 3 encaminha diretamente à recepção. Apenas a ação `solicitar_qualificacao` chama o novo caso de uso. Estados humanos/encerrados, mensagens próprias e mídias não acionam o qualificador.

1. O worker reserva o job existente. O store bloqueia **job → conversa → mensagem → lead**, revalida elegibilidade/estado e grava uma reserva única em `qualification_runs` por mensagem. Cria um lead Novo se necessário, permitindo assunção imediata. Não altera a conversa para `qualificando`: a reserva persistida representa o trabalho em andamento e mantém a recuperação existente utilizável.
2. Confirma a reserva e libera os locks. O qualificador recebe apenas dados administrativos do perfil (nome/serviços), mensagem atual e até dez textos anteriores de entrada do mesmo ciclo, em ordem cronológica. Não recebe telefone, IDs internos, outros ciclos, prompts secretos ou credenciais. Mensagens repetidas no contexto são removidas. O JSON de entrada tem limite configurável; truncamento exige revisão.
3. Executa uma única tentativa, com timeout e AbortSignal. Modo simulado não carrega/inicializa o cliente Gemini. O adapter opcional usa `@google/genai` **3.4.0**, `models.generateContent`, JSON Schema, MIME JSON, limite de tokens e retries do SDK desabilitados (`attempts: 1`). Não há fallback para modelo pago.
4. Zod valida candidatos. O backend decide os campos e a classificação; narrativa livre do modelo nunca vira resumo nem mensagem enviada. Aplica resultado + estado + conclusão do job em outra transação, revalidando reserva/tentativa e os estados atuais.

Se assunção/encerramento ocorrer durante a chamada, seu resultado é descartado sem alterar o lead, a conversa ou as informações humanas. A tentativa antiga também perde autorização após recuperação do job. Não há segunda fila.

Se o processo cair depois da reserva, a retomada usa fallback `interrupted`, **sem repetir a chamada externa**. Uma falha SQL ao aplicar o resultado também conserva a reserva e segue essa política na próxima tentativa: prioriza revisão humana e controle de cota, podendo perder uma classificação válida que ainda não havia sido confirmada. Não há garantia de exatamente uma execução no servidor externo, apenas de não solicitar novamente a mesma mensagem nesta aplicação. O timeout pode abortar a espera local mesmo que o provedor já tenha processado a requisição.

## Contratos e classificação

O candidato contém intenção (`agendamento`, `informacoes` ou null), `serviceId`, período, resumo, revisão e evidências textuais por campo. A saída final contém intenção, serviço ID/nome, período, resumo administrativo, `needsReview`, `source` (`simulated`/`gemini`) e `status` (`qualificado`, `revisao`, `falha`; `processando` é projeção da reserva ativa).

- **Qualificado:** intenção explícita de agendar/marcar, exatamente um serviço do catálogo comprovado pelo nome/ID no texto e período/dia/horário explícito em formato administrativo reconhecido. Sem ambiguidades, negações, truncamento, pedido de revisão ou instruções suspeitas.
- **Novo + Revisar:** dados incompletos, contraditórios, serviço desconhecido, alternativas (“ou”), negativas/incerteza ou instruções para alterar regras/estado. Mantém os campos válidos disponíveis; não preenche ausências com suposições.
- **Falha + Revisar:** timeout, 429, rede, JSON/schema inválido, contexto excessivo ou reserva interrompida. Preserva campos/resumo anteriores. Um lead previamente qualificado não é regredido; a marca Revisar é acrescentada. Uma marca Revisar existente nunca é removida automaticamente.

Períodos aceitos são conservadores: hoje/amanhã/dias da semana, manhã/tarde/noite e horários explícitos, incluindo combinações como “amanhã à tarde”. Expressões não reconhecidas seguem para revisão; o sistema não confirma agenda. Não usa confiança do modelo para definir etapa. O resumo é composto de campos comprovados pelo backend. Os filtros de instruções/termos clínicos são defesa adicional, não uma promessa de reconhecer toda tentativa maliciosa. A saída não contém ações, ferramentas, estados Ganho/Perdido ou texto a enviar.

O simulado usa padrões explícitos para exemplos sintéticos; não representa um LLM generalista. Após “Olá” e o menu, **“Quero agendar avaliação amanhã à tarde”** qualifica; **“Quero agendar avaliação”** exige revisão; **“Quero agendar avaliação ou sessão de fisioterapia amanhã”** é ambíguo.

## Persistência e migração manual

Migração `apps/api/migrations/1794956400000_create_qualification_runs.sql`:

- Acrescenta `leads.qualification` JSONB nullable, com check estrutural; leads anteriores permanecem intactos. `summary`, etapa e revisão existentes são reutilizados.
- Cria `qualification_runs`: mensagem PK, conversa, job, tentativa reservada, origem, status, resultado JSON validado, código técnico e datas. FKs compostas garantem mensagem/conversa e job/mensagem corretos. Não armazena prompt ou resposta bruta.
- A leitura do painel apresenta o resultado do lead ou uma projeção Processando da reserva ativa. Assunção/encerramento continuam usando os contratos anteriores.

Depois de revisar a branch, com PostgreSQL disponível, execute na raiz:

```powershell
npm ci
npm run db:check
npm run db:migrate
npm run start:demo
```

Apenas a **sétima migração** deve estar pendente se as seis anteriores já foram aplicadas. Ela **não foi aplicada ao banco principal pelo Codex**. Não apaga dados existentes. A reversão, testada exclusivamente em banco descartável, remove apenas a reserva e a coluna adicionadas; não use down para desfazer dados reais de qualificação sem planejar sua preservação.

## Configuração

O `.env.example` inclui:

```dotenv
QUALIFIER_PROVIDER=simulated
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
QUALIFIER_TIMEOUT_MS=15000
QUALIFIER_MAX_CONTEXT_CHARS=8000
QUALIFIER_MAX_OUTPUT_CHARS=4000
```

Não é necessário alterar o `.env` para testar o simulado: defaults acima. Os limites validados são timeout 100–30000 ms (padrão 15000; **com `QUALIFIER_PROVIDER=gemini`, mínimo de 10000 ms**), contexto 1000–20000 caracteres de JSON e saída 500–12000 caracteres; o SDK limita também a resposta a 768 tokens. O prompt de sistema fixo é adicional ao limite de dados do contexto. A API exige a chave somente quando `QUALIFIER_PROVIDER=gemini`. Outro identificador de modelo é rejeitado, sem substituição silenciosa.

O SDK `@google/genai` não usa `httpOptions.timeout` apenas como limite local: ele também o envia ao Google como prazo do servidor. O Google recusa prazos abaixo de 10 s com HTTP 400 `INVALID_ARGUMENT` ("Manually set deadline ... is too short. Minimum allowed deadline is 10s."). Por isso a API não inicia com Gemini e `QUALIFIER_TIMEOUT_MS` abaixo de 10000, e informa o mínimo na mensagem de erro. O modo simulado continua aceitando valores menores, porque não faz chamada externa. O trade-off é que uma chamada lenta ao Gemini pode segurar o job por até o prazo configurado (15 s por padrão) antes de virar Novo + Revisar.

Para um teste **real e explícito**, configure localmente `QUALIFIER_PROVIDER=gemini` e preencha `GEMINI_API_KEY` no `.env` ignorado; mantenha o modelo indicado e reinicie `start:demo`. Não envie a chave ao chat, Postman ou GitHub. Ao iniciar, o worker também pode processar jobs sintéticos antigos elegíveis no banco configurado: isso consome cota se Gemini estiver ativo. Volte a `simulated` e reinicie ao terminar.

Os limites de 15 RPM, 250 mil TPM e 500 requisições/dia foram observados pelo autor no seu projeto e podem mudar; não são uma garantia nem são controlados por um contador local. 429 vira revisão, sem retry automático. Use somente dados sintéticos administrativos. O nível gratuito não deve ser presumido adequado a dados clínicos reais; revisar termos e configuração antes de qualquer uso diferente da demonstração.

Referências oficiais consultadas: [modelo exato](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [JSON estruturado](https://ai.google.dev/gemini-api/docs/structured-output), [timeout](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html) e [retries](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html). A API inclui tipos DOM no tsconfig exclusivamente para verificar os tipos HTTP/eventos do SDK; a chave e o SDK permanecem no backend.

## Diagnostico seguro do Gemini

Falhas do provedor continuam sendo persistidas com os codigos de dominio ja suportados (por exemplo, `qualifier_failure` e `rate_limited`) para manter o contrato e o fallback Novo + Revisar. O terminal agora registra um objeto JSON com `category`, `httpStatus` quando houver, `providerCode` de uma lista permitida, `networkCode` de uma lista permitida, `diagnosticId` e o UUID do job. O log nunca inclui mensagem original da excecao, chave, cabecalhos, prompt, resposta bruta ou dados do contato.

Categorias `http_400`, `http_401`, `http_403`, `http_404`, `http_429` e `http_5xx` distinguem respostas HTTP; `network_error`, `timeout`, `configuration_error` e `internal_error` ajudam a separar falhas locais. Para investigar uma nova tentativa real, localize no terminal a linha `gemini_qualification_failure` pelo `jobId` ou `diagnosticId`; um 400 pode trazer `providerCode` seguro, como `API_KEY_INVALID` ou `INVALID_ARGUMENT`. O codigo persistido no banco permanece propositalmente mais amplo. As duas tentativas anteriores nao foram suficientes para estabelecer a causa: a implementacao anterior descartava esse diagnostico.

O schema derivado do Zod é adaptado ao subconjunto documentado pelo Gemini: campos de texto anuláveis usam o tipo string/null e o enum anulável `intent` usa `anyOf` com um ramo string enumerado e outro null. Metadados de draft e limites de comprimento não suportados são removidos do schema enviado. O Zod continua aplicando todos os limites e regras no retorno do modelo. Para `gemini-3.1-flash-lite`, o adapter deixa a temperatura no padrão recomendado pelo provedor; preserva `maxOutputTokens: 768`, timeout configurado e uma tentativa do SDK, sem retry automático.

Quando o erro do provedor trouxer `fieldViolations`, o diagnóstico pode acrescentar `providerField` se o caminho contiver apenas campos técnicos conhecidos e `providerDetail` como código sanitizado. A descrição original permanece fora dos logs.

### Diagnóstico isolado de requisições Gemini

Para localizar em qual camada a API rejeita a chamada, execute manualmente na raiz:

```powershell
npm run diagnose:gemini
```

O comando compila a API e inicia um diagnóstico independente; não inicia o worker, não acessa PostgreSQL e não aplica migrações. Antes de chamar a API, mostra o aviso de consumo e exige digitar `EXECUTAR`. Ele exige `GEMINI_API_KEY` e `GEMINI_MODEL` explícitos no `.env`, usa o SDK 3.4.0 e as opções de produção (timeout e uma tentativa, sem retry). Não altere nem compartilhe a chave.

As etapas são sequenciais e param na primeira falha: A testa autenticação/modelo com texto; B acrescenta `responseMimeType`; C acrescenta um schema mínimo; D usa `geminiQualificationRequest()` e `geminiResponseJsonSchema()` reais, com contexto sintético e limite de 768 tokens igual ao adapter. A–C limitam a saída a 24 tokens. Portanto serão feitas de uma a quatro chamadas, no máximo, com até 840 tokens de saída configurados no total; tokens de entrada também podem consumir cota. A cobrança/cota depende do modelo e da conta. Recusar a confirmação não envia requisição. As respostas do modelo, prompt, chave e corpo do erro não são impressos. “Aprovado” significa que a chamada foi aceita e respondeu sem erro de transporte/API, não que o texto gerado foi validado para uso em produção.

Cada linha JSON informa etapa, modelo, resultado, duração e, quando disponível, status HTTP, código permitido, campo de schema seguro e categoria técnica. Se A falhar, investigue chave, acesso ao modelo, rede ou disponibilidade antes do schema. Se A passar e B falhar, a rejeição está associada ao modo JSON. Se B passar e C falhar, investigue suporte a schema estruturado. Se C passar e D falhar, a evidência aponta para o schema/configuração completa do adapter. Se D passar, o schema e configuração isolados foram aceitos; compare então o caminho real do worker e seus dados/contexto sintético, sem concluir que o fluxo de produção foi validado. O comando não executa chamadas reais em `npm run check`, `npm run test` ou `npm run test:integration`.

### Causa confirmada do HTTP 400

A execução manual do diagnóstico mostrou que o HTTP 400 `INVALID_ARGUMENT` vinha do prazo, não do schema: com o antigo padrão `QUALIFIER_TIMEOUT_MS=8000`, o Google respondeu "Manually set deadline 8s is too short. Minimum allowed deadline is 10s.". Com `QUALIFIER_TIMEOUT_MS=15000` no `.env` local, as quatro etapas passaram. As correções de schema anteriores (`167bea6`, que adaptou nullable e removeu limites de tamanho, e `941b77b`, que trocou o enum nullable por `anyOf`) não eram a causa da falha. Elas foram mantidas porque o schema atual foi aceito na etapa D, mas não devem ser citadas como a correção do 400. A partir desta correção, o padrão é 15000 ms e a configuração com Gemini rejeita valores abaixo de 10000 ms ao iniciar.

## Interface e Postman

Abra `/simulator` e `/admin`. Novo telefone fictício → “Olá” → aguarde menu → texto completo acima. Confira card Qualificado, serviço/período, resumo e origem **Simulada (sem IA externa)**. Outro contato com texto incompleto deve ficar Novo/Revisar. Opção 3 continua sem qualificação. Assumir, encerrar, consultar encerrados e iniciar novo ciclo continuam disponíveis. A revisão visual do navegador permanece a cargo do autor; os testes web usam DOM mínimo.

Não foi adicionado endpoint para chamar Gemini diretamente. Use a recepção existente:

```http
POST http://127.0.0.1:3000/webhooks/simulator
Content-Type: application/json
```

```json
{
  "id": "postman-qualificacao-01",
  "from": "+15550114971",
  "fromMe": false,
  "type": "text",
  "body": "Olá",
  "timestamp": "2026-11-17T12:00:00Z"
}
```

Depois da abertura, envie novo `id` (`postman-qualificacao-02`) e `body: "Quero agendar avaliação amanhã à tarde"`. Reenviar o mesmo ID deve retornar `duplicada`, sem novo job/qualificação. O 200 do webhook confirma recepção, **não o resultado assíncrono**. Consulte `GET /api/demo/conversations`: `lead.qualification` expõe os campos/origem/status e `lead.stage`/`needsReview` refletem a decisão. Histórico: `GET /api/demo/conversations/:id/messages`; assunção: `POST /api/demo/leads/:id/assume`; encerramento: `POST /api/demo/leads/:id/close` com `{ "result": "ganho" }` ou `perdido`. Os IDs dessas rotas são conversa/lead, respectivamente.

## Revisão e testes

Leia: contratos compartilhados e `modules/leads/contracts/qualification.ts` → `qualification-rules.ts` e `qualify-message.ts` → porta `qualification-execution-store.ts` → migração/store PostgreSQL → adapters simulado/Gemini/factory → `simulator-processor.ts` e `demo.ts` → read model → frontend → testes. Os caminhos completos alterados estão listados ao final.

`npm run check` passou: **159 testes da API + 7 web**, tipos e build (após o diagnóstico escalonado e a correção do prazo mínimo do Gemini: **168 testes da API + 7 web**). `npm run test:integration` passou: **211 registros**, sem falhas ou avisos de conexão. A espera da abertura no teste do processo real foi ajustada para observar conclusão do job, não apenas o estado inicial da conversa. Casos cobrem elegibilidade, evidência, contexto, falhas/timeout, rollback, duplicatas, reserva recuperada, resultados atrasados após assunção e encerramento, novo ciclo, ausência de texto livre enviado e preservação das ações web. Todos os adapters Gemini dos testes usam transportes fake; nenhuma chamada real ocorreu.

O npm audit reportou **3 avisos moderados preexistentes na cadeia node-pg-migrate/glob/minimatch**, cujas versões foram preservadas; não foi aplicado `audit fix --force`. A instalação trouxe aviso de depreciação transitiva de `node-domexception`. Essas atualizações não foram misturadas à funcionalidade. Teste Gemini com credencial real permanece manual; não foram verificados consumo/cota ou resposta efetiva da conta do autor.

### Arquivos alterados nesta entrega

- `.env.example`
- `README.md`
- `apps/api/package.json`
- `apps/api/src/demo.ts`
- `apps/api/src/infrastructure/simulator/postgres-demo-read-model.ts`
- `apps/api/src/infrastructure/simulator/simulator-flow.integration.test.ts`
- `apps/api/src/modules/jobs/infrastructure/postgres-job-lifecycle.integration.test.ts`
- `apps/api/src/modules/jobs/infrastructure/postgres-job-queue.integration.test.ts`
- `apps/api/src/modules/jobs/infrastructure/postgres-job-recovery.integration.test.ts`
- `apps/api/src/modules/leads/infrastructure/postgres-reception-lead-store.ts`
- `apps/api/src/modules/messaging/infrastructure/postgres-message-processing-context-reader.integration.test.ts`
- `apps/api/src/modules/messaging/infrastructure/postgres-message-response-plan-reader.integration.test.ts`
- `apps/api/src/modules/messaging/infrastructure/postgres-message-response-plan-store.integration.test.ts`
- `apps/api/src/modules/simulator/application/simulator-processor.ts`
- `apps/api/tsconfig.json`
- `apps/web/README.md`
- `apps/web/index.html`
- `apps/web/scripts/demo-ui.test.js`
- `apps/web/src/demo.ts`
- `apps/web/src/styles/kanban.css`
- `docs/01-escopo-e-requisitos.md`
- `docs/04-modelagem-de-dados.md`
- `package-lock.json`
- `packages/shared/src/demo.ts`
- `packages/shared/src/index.ts`
- `apps/api/migrations/1794956400000_create_qualification_runs.sql`
- `apps/api/src/config/qualification.ts`
- `apps/api/src/modules/leads/application/lead-qualification.test.ts`
- `apps/api/src/modules/leads/application/qualification-execution-store.ts`
- `apps/api/src/modules/leads/application/qualification-rules.ts`
- `apps/api/src/modules/leads/application/qualify-message.ts`
- `apps/api/src/modules/leads/contracts/qualification.ts`
- `apps/api/src/modules/leads/infrastructure/create-lead-qualifier.ts`
- `apps/api/src/modules/leads/infrastructure/gemini-lead-qualifier.ts`
- `apps/api/src/modules/leads/infrastructure/postgres-qualification-execution-store.ts`
- `apps/api/src/modules/leads/infrastructure/simulated-lead-qualifier.ts`
- `docs/32-qualificacao-de-leads.md`
- `packages/shared/src/qualification.ts`

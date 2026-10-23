# Etapa 3 — Base do monorepo

Entrega implementada na branch `chore/base-monorepo`, pronta para revisão individual. O escopo é a estrutura dos pacotes, a configuração TypeScript e os scripts de verificação descritos no documento 7.

## 1. O que foi preparado

```text
package.json                  Workspaces, ferramentas e scripts da raiz
package-lock.json             Resolução das dependências e links locais
tsconfig.base.json            Regras comuns de TypeScript
.npmrc                        Compatibilidade de engines e versões exatas
.nvmrc                        Versão de referência do Node
.editorconfig                 Convenções para editores compatíveis
apps/api/
  package.json                Pacote do backend; depende de shared
  tsconfig.json               Ambiente Node
  src/index.ts                Ponto de entrada reservado
  README.md                   Responsabilidades e limites
apps/web/
  package.json                Pacote do dashboard; depende de shared
  tsconfig.json               Ambiente do navegador
  src/index.ts                Ponto de entrada reservado
  README.md                   Responsabilidades e limites
packages/shared/
  package.json                Interface pública do pacote
  tsconfig.json               JavaScript e declarações de tipos
  src/index.ts                Entrada dos futuros contratos
  README.md                   Responsabilidades e limites
```

Os arquivos `src/index.ts` contêm apenas comentários e `export {}`. Isso permite verificar e compilar a configuração sem introduzir regras de negócio ou contratos fictícios. O servidor Express, a interface React e os contratos Zod serão implementados nas próximas entregas. Docker não foi usado nesta entrega.

## 2. Ambiente e pacotes instalados

Node `24.14.1` e npm `11.11.0` já estavam instalados na máquina; foram identificados e usados como referência, sem atualização do ambiente.

As duas dependências diretas instaladas são ferramentas de desenvolvimento na raiz:

| Pacote | Versão exata | Finalidade |
|---|---|---|
| `typescript` | `7.0.2` | Verificar os tipos e compilar os três pacotes |
| `@types/node` | `24.19.2` | Fornecer os tipos da família Node 24 ao backend |

O npm também instalou dependências transitivas: `undici-types@7.24.6`, usado por `@types/node`, e `@typescript/typescript-win32-x64@7.0.2`, o compilador específico desta plataforma. O lockfile registra as variantes opcionais do compilador para outras plataformas; elas não são necessárias nesta máquina.

`@copilot-leads/api`, `@copilot-leads/web` e `@copilot-leads/shared` são os pacotes locais do próprio repositório. O npm criou seus links de workspace em `node_modules`; eles não foram obtidos do registro público.

As dependências de execução de Express, Zod, React e PostgreSQL ainda não foram instaladas. Elas entrarão quando suas funcionalidades forem implementadas. Também não foi criado um conjunto de testes de negócio para os pontos de entrada vazios; as verificações desta entrega são de configuração, compilação e resolução dos pacotes.

## 3. Comandos executados na instalação

As versões foram consultadas no registro npm antes da instalação. O TypeScript `7.0.2` era a versão retornada pelo registro como estável na execução desta entrega. Os tipos do Node foram escolhidos na família 24.

```sh
npm install --save-dev --save-exact typescript@7.0.2 @types/node@24.19.2 --ignore-scripts --no-fund --fetch-retries=0 --fetch-timeout=30000
npm ci --ignore-scripts --no-fund --fetch-retries=0 --fetch-timeout=30000
```

- `--save-dev`: registra ferramentas de desenvolvimento em `devDependencies` da raiz.
- `--save-exact`: grava versões exatas, sem intervalos como `^`.
- `--ignore-scripts`: instala os pacotes sem executar seus scripts de instalação; os comandos explícitos `npm run` continuam disponíveis.
- `--no-fund`: omite mensagens de financiamento.
- `--fetch-retries` e `--fetch-timeout`: limitam a espera das consultas de rede desta execução.
- `npm ci`: validou a reinstalação usando o lockfile gerado. Nas próximas instalações do projeto, o comando é `npm ci` na raiz.

A instalação e a reinstalação reportaram zero vulnerabilidades na auditoria automática do npm nesta execução.

## 4. Como os pacotes se relacionam

```text
apps/api ──────┐
              ├──> packages/shared
apps/web ──────┘
```

As duas aplicações declaram `@copilot-leads/shared: "0.0.0"` como dependência local. O pacote compartilhado não depende das aplicações. A interface pública de `shared` está no campo `exports` do seu `package.json`: JavaScript em `dist/index.js` e tipos em `dist/index.d.ts`.

API e web possuem `exports: {}`, pois são aplicações e não oferecem uma interface de pacote para importação pelo nome. Foi verificado que importar `@copilot-leads/api` pelo nome a partir de web é bloqueado. Isso não impede todo acesso possível por caminho relativo: manter as fronteiras também exige organização do código e revisão.

`private: true` evita a publicação acidental desses pacotes no npm. Não representa controle de acesso à aplicação ou configuração de visibilidade do repositório Git.

## 5. TypeScript e configurações locais

Cada pacote estende o mesmo `tsconfig.base.json`, com ajustes para seu ambiente:

| Configuração | Efeito |
|---|---|
| `strict: true` | Habilita as verificações estritas, incluindo valores nulos e `any` implícito |
| `noUncheckedIndexedAccess: true` | Considera a possível ausência ao acessar posições e chaves não garantidas |
| `exactOptionalPropertyTypes: true` | Distingue uma propriedade ausente de uma propriedade explicitamente definida como `undefined`, conforme seu tipo |
| `noUnusedLocals` e `noUnusedParameters` | Detectam declarações e parâmetros não utilizados |
| `noImplicitReturns` e `noFallthroughCasesInSwitch` | Verificam caminhos de retorno e continuidade acidental entre casos de `switch` |
| `verbatimModuleSyntax: true` | Mantém explícita a distinção entre importações de valores e de tipos |
| `noEmitOnError: true` | Não gera novos arquivos do pacote quando há erros de compilação |
| `sourceMap: true` | Gera mapas que relacionam o JavaScript compilado ao TypeScript original |

`strict` não proíbe todo `any` explícito e não valida dados recebidos por HTTP. A revisão de código, futuras regras de lint e a validação Zod têm responsabilidades complementares.

- **API:** módulos `NodeNext`, bibliotecas ES2023 e `types: ["node"]`.
- **Web:** módulos `ESNext`, resolução `Bundler` e bibliotecas ES2023/DOM. Essa configuração prepara a tipagem do navegador; o empacotador e a interface ainda serão adicionados.
- **Shared:** bibliotecas ES2023, sem tipos globais do Node ou DOM; emite declarações e mapas de declarações para os consumidores.

Todos os pacotes usam ESM por meio de `type: "module"`. Cada um compila `src` para seu próprio `dist`. A configuração base usa `types: []` para que instalar tipos de Node na raiz não os habilite automaticamente no navegador ou nos contratos.

`.nvmrc` registra Node `24.14.1`. `packageManager` registra npm `11.11.0`. Os intervalos de `engines` aceitam Node a partir de `24.14.1` na família 24 e npm a partir de `11.11.0` na família 11; `engine-strict=true` exige compatibilidade nas instalações. Esses arquivos não instalam nem atualizam Node e npm automaticamente.

`.npmrc` também usa `save-exact=true` para futuras instalações. `.editorconfig` registra UTF-8, indentação com dois espaços e finais de linha LF para ferramentas compatíveis; ele não substitui um linter ou um formatador. O `.gitignore` existente já ignora `node_modules` e os diretórios `dist` e foi preservado.

## 6. Scripts e ordem de compilação

Execute na raiz:

```sh
npm run typecheck
npm run build
npm run check
```

Os três comandos não precisam ser executados em sequência: `check` já executa os outros dois.

| Script | O que faz |
|---|---|
| `typecheck` | Compila `shared` para disponibilizar seus tipos públicos e depois executa `tsc --noEmit` em cada pacote |
| `build` | Compila os workspaces na ordem declarada: shared, API e web |
| `check` | Executa typecheck e build, falhando se uma etapa falhar |

A ordem explícita de `workspaces` é importante: o npm executa os scripts nessa ordem, e os consumidores precisam encontrar os tipos de `shared`. Nesta base pequena, a sequência pode ser vista diretamente no `package.json`; uma ferramenta adicional de orquestração não foi necessária.

O build do pacote web nesta etapa é somente compilação TypeScript; não produz uma página pronta para abrir no navegador. Ainda não há servidor HTTP para iniciar, interface para navegar ou fluxo de negócio para demonstrar.

## 7. Verificações e roteiro de revisão

Verificações executadas:

- Instalação das versões exatas e reinstalação pelo `package-lock.json` com `npm ci`.
- `npm run check`: verificação de tipos e compilação dos três pacotes.
- Resolução de `@copilot-leads/shared` a partir de API e web para o pacote local compilado.
- Bloqueio da importação do backend pelo nome do pacote, conforme `exports`.
- Verificação de que `node_modules` e os artefatos de `dist` são ignorados pelo Git.

Sugestão de ordem para sua revisão:

1. [package.json da raiz](../package.json): workspaces, scripts, versões e ferramentas.
2. [tsconfig.base.json](../tsconfig.base.json): regras comuns de tipagem.
3. Configurações da [API](../apps/api/tsconfig.json), do [dashboard](../apps/web/tsconfig.json) e de [shared](../packages/shared/tsconfig.json): diferenças entre os ambientes.
4. Manifests da [API](../apps/api/package.json), de [web](../apps/web/package.json) e de [shared](../packages/shared/package.json): dependências e interfaces públicas.
5. [package-lock.json](../package-lock.json): versões resolvidas, dependências transitivas e links de workspace; arquivo gerado pelo npm.
6. [README da raiz](../README.md) e os READMEs dos pacotes: como verificar a entrega e quais responsabilidades cada parte terá.

A entrega é registrada em commits separados de documentação e configuração na branch `chore/base-monorepo`. A integração na `main` depende da revisão individual do autor. A documentação que já existia sem versionamento no início desta etapa foi preservada e passa a fazer parte do histórico do repositório.

Referências de estudo: [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [opções do TypeScript](https://www.typescriptlang.org/tsconfig/) e [interfaces públicas de pacotes Node](https://nodejs.org/api/packages.html#package-entry-points).

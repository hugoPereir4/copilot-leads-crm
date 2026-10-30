# Etapa 4.1 — PostgreSQL local com Docker Compose

Configuração preparada em 29/10/2026 na branch `chore/postgres-local`, a partir da base revisada da etapa 3. A integração da etapa 3 na `main` permanece uma operação separada.

**Estado desta entrega:** preparação do PostgreSQL local concluída e validada pelo autor. Em 29/10/2026, a saída compartilhada de `docker compose ps` confirmou o container `healthy` e o mapeamento `127.0.0.1:15432->5432/tcp`; a consulta SQL dentro do container retornou o banco `copilot_leads` e o usuário `copilot_dev`. Em 30/10/2026, o autor confirmou a gravação do marcador `1`, recriou o container com `--force-recreate`, consultou novamente o mesmo valor e removeu a tabela de verificação, recebendo `DROP TABLE`. O acesso da aplicação pela porta do Windows será implementado e validado na próxima entrega de persistência. Esta preparação de infraestrutura não conclui a etapa 4 de recebimento e persistência de mensagens.

## 1. O que cada parte faz

| Conceito | No nosso projeto |
|---|---|
| Imagem | `postgres:18.6-bookworm`: pacote oficial com PostgreSQL e seu ambiente de execução |
| Container | Instância da imagem que executa o processo do banco |
| Serviço Compose | `postgres`: nome usado nos comandos desta configuração |
| Porta | Encaminha a porta local configurável (`15432` nesta máquina) em `127.0.0.1` do Windows à porta `5432` do container |
| Volume | `postgres_data`: armazenamento gerenciado pelo Docker que pode ser reutilizado após recriar o container |
| Healthcheck | Consulta periódica com `pg_isready` para indicar se o servidor aceita conexões |

O Docker Desktop fornece o ambiente Linux. O Compose lê [compose.yaml](../compose.yaml) e coordena os recursos declarados nele. A API e o dashboard continuam fora dos containers nesta fase, conforme D10.

O monólito modular descreve a organização do backend. O serviço `postgres` do Compose é infraestrutura; não é um módulo de negócio nem transforma a aplicação em microserviços.

## 2. Arquivos e decisões da configuração

- [compose.yaml](../compose.yaml): define um serviço PostgreSQL, sua porta local, o volume e a verificação de saúde.
- [.env.example](../.env.example): modelo versionado das variáveis necessárias. A senha fica em branco de propósito.
- `.env`: arquivo local preenchido por você. O `.gitignore` existente já o ignora.

A imagem usa uma versão explícita, `18.6-bookworm`, disponível entre as tags oficiais consultadas na preparação. Isso evita trocar de versão principal pelo uso da tag `latest`; a tag não é uma garantia de imutabilidade por digest.

O volume está montado em `/var/lib/postgresql`, que é o destino indicado para a imagem PostgreSQL 18 ou superior. A imagem organiza os arquivos em um subdiretório específico da versão. Essa escolha precisa acompanhar a versão da imagem.

`POSTGRES_DB`, `POSTGRES_USER` e `POSTGRES_PASSWORD` são exigidos pela configuração; valores ausentes ou vazios impedem o início do serviço. A porta local usa `5432` por padrão. O endereço `127.0.0.1` limita a publicação à própria máquina.

No healthcheck, `$$` preserva o cifrão para que o shell dentro do container leia as variáveis. O healthcheck verifica prontidão; executar consultas, validar a conexão usada pela aplicação e verificar a persistência são verificações separadas.

## 3. Primeira execução, acompanhada pelo autor

Mantenha o Docker Desktop aberto. No PowerShell, entre na raiz do projeto:

```powershell
Set-Location -LiteralPath 'C:\Projetos\copilot-leads-crm\copilot-leads-crm'
```

Se o terminal não reconhecer `docker`, na instalação por usuário identificada nesta máquina é possível incluir os executáveis no `PATH` apenas da sessão atual:

```powershell
$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
$env:Path = "$dockerBin;$env:Path"
Get-Command docker,docker-credential-desktop
```

O comando final deve localizar os dois executáveis. O Docker também precisa encontrar seu auxiliar de credenciais no `PATH` para consultar o armazenamento configurado durante o download da imagem. Usar somente o caminho absoluto de `docker.exe` não torna esse auxiliar disponível. Esse ajuste não altera permanentemente as variáveis do Windows; vale para a sessão atual e seus processos filhos.

### Passo A — Criar sua configuração local

Na primeira configuração, se ainda não existir um `.env`, copie o modelo:

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

Abra o `.env` no editor e preencha `POSTGRES_PASSWORD` com uma senha de desenvolvimento. Não precisa enviar a senha no chat. Pode manter os demais valores do exemplo. Caso já exista um `.env`, edite esse arquivo e preserve as configurações existentes em vez de copiá-lo por cima.

Essas variáveis inicializam o banco quando o volume está vazio. Alterar o `.env` depois não altera automaticamente um usuário, senha ou banco já criado; nesse caso, a mudança precisa ser feita no PostgreSQL.

Nesta máquina, outro processo `postgres` já ocupava a porta `5432` do Windows. Foi definido `POSTGRES_PORT=15432` no `.env` para publicar o banco do projeto em outra porta. Dentro do container, o PostgreSQL continua usando `5432`. A mudança da porta publicada não altera os dados nem exige apagar o volume.

### Passo B — Validar o arquivo

```powershell
docker compose config --quiet
```

Esse comando lê a configuração e verifica sua composição, sem iniciar containers nem baixar a imagem. `--quiet` evita imprimir os valores resolvidos, incluindo a senha. Sucesso é terminar sem mensagem de erro.

### Passo C — Iniciar o banco

```powershell
docker compose up -d --wait --wait-timeout 120 postgres
```

- `up`: prepara os recursos e inicia o serviço; na primeira execução, baixa a imagem se ela não estiver disponível.
- `-d`: mantém o serviço executando em segundo plano.
- `--wait`: aguarda o serviço atingir a condição de saúde configurada.
- `--wait-timeout 120`: limita a espera de prontidão a 120 segundos.
- `postgres`: seleciona o serviço definido no arquivo.

O container, a rede e o volume poderão aparecer agrupados como `copilot-leads-crm` no Docker Desktop. O nome do container é gerado pelo Compose; não é preciso criá-lo manualmente na interface.

### Passo D — Conferir o estado

```powershell
docker compose ps
```

O serviço deve aparecer em execução e com a condição `healthy`. Esse resultado foi confirmado pelo autor. Se houver falha na inicialização, consulte os logs:

```powershell
docker compose logs --tail 50 postgres
```

### Passo E — Executar uma consulta SQL

Com o container saudável, execute no PowerShell:

```powershell
docker compose exec postgres psql -U copilot_dev -d copilot_leads -c "SELECT current_database(), current_user;"
```

O comando usa os nomes de usuário e banco de `.env.example`; caso tenha escolhido outros, ajuste os argumentos `-U` e `-d`. `exec` executa um comando no container em execução. `psql` é o cliente de terminal já incluído na imagem; `-c` executa a consulta e encerra o cliente. O container continua em execução.

O autor confirmou uma linha com `copilot_leads` e `copilot_dev`. A consulta apenas lê informações da sessão. Esta verificação usa uma conexão local dentro do container; não valida a senha nem o acesso pela porta `15432` do Windows. Essa conexão será verificada ao preparar o acesso da aplicação ao banco. O teste de persistência do volume está registrado nos passos F e G.

### Passo F — Preparar um dado para verificar o volume

Vamos gravar um marcador, recriar o container mantendo o volume e consultar o marcador novamente. O primeiro comando apenas prepara o dado:

```powershell
docker compose exec postgres psql -U copilot_dev -d copilot_leads -c "CREATE TABLE public.infra_volume_check AS SELECT 1 AS marcador; SELECT * FROM public.infra_volume_check;"
```

Esse comando cria uma tabela de verificação com uma linha e consulta seu conteúdo. O PostgreSQL responde `SELECT 1` à criação por `CREATE TABLE ... AS SELECT`, indicando uma linha gravada; em seguida, a consulta retorna uma linha com `marcador` igual a `1`. O autor confirmou esse resultado em 30/10/2026. Execute uma única vez; a tabela permanece no banco para a leitura após recriar o container. Ela será removida ao terminar a verificação e não faz parte do modelo de negócio ou das futuras migrações.

Se `exec` responder que o serviço não está em execução, mantenha o Docker Desktop aberto e inicie o banco com o comando do passo C. `exec` exige um container em execução e não inicia o serviço automaticamente.

### Passo G — Recriar o container e consultar o marcador

Com a gravação do passo F confirmada, execute:

```powershell
docker compose up -d --force-recreate --wait --wait-timeout 120 postgres
```

`--force-recreate` substitui o container mesmo sem mudanças na configuração. O banco ficará indisponível por alguns segundos. O Compose preserva o volume nomeado `postgres_data` e o conecta ao novo container; `--wait` aguarda a condição `healthy`.

Após o comando terminar com sucesso, execute somente a leitura, sem repetir a criação da tabela:

```powershell
docker compose exec postgres psql -U copilot_dev -d copilot_leads -c "SELECT * FROM public.infra_volume_check;"
```

O autor confirmou, em 30/10/2026, o novo container `healthy` e uma linha com `marcador` igual a `1`. O dado sobreviveu à recriação do container com o mesmo volume. A limpeza posterior está registrada no passo H.

### Passo H — Remover a tabela de verificação

Após confirmar o passo G, remova a tabela criada exclusivamente para esse teste:

```powershell
docker compose exec postgres psql -U copilot_dev -d copilot_leads -c "DROP TABLE public.infra_volume_check;"
```

O comando remove a tabela `public.infra_volume_check`, incluindo a linha com o marcador. O banco, o usuário e o volume permanecem disponíveis. O autor confirmou o resultado `DROP TABLE` em 30/10/2026, concluindo a limpeza.

## 4. Parar e voltar a executar

Para parar o processo mantendo o container e seus dados:

```powershell
docker compose stop postgres
```

Para voltar, use o comando `up` do passo C. `docker compose down` remove os containers e a rede do projeto, mantendo o volume nomeado por padrão. A opção `--volumes` também remove os volumes e seus dados; ela não faz parte deste roteiro.

A consulta do passo E, a verificação de persistência dos passos F e G e a limpeza do passo H foram confirmadas. O volume persistente não substitui backup.

## 5. O que revisar

1. Relacione cada bloco de `compose.yaml` aos conceitos da seção 1.
2. Confira como `.env.example` fornece nomes de configuração sem guardar uma senha real.
3. Observe que os dados estão no volume e que o código da aplicação não depende de Docker.
4. Compare o resultado dos comandos com o estado mostrado no Docker Desktop.

Ainda não há tabelas de negócio, migrações, integração da API com o banco ou novas dependências npm nesta entrega. A ferramenta de acesso ao banco será escolhida antes de implementar a persistência das mensagens.

Para versionar esta entrega, os arquivos são `compose.yaml`, `.env.example`, este guia e as atualizações do `README.md` e do documento 7. O `.env` com a senha local está ignorado pelo Git. A imagem baixada, os containers e os dados do volume são recursos locais do Docker e não entram no commit.

Referências oficiais: [imagem PostgreSQL](https://hub.docker.com/_/postgres), [serviços do Compose](https://docs.docker.com/reference/compose-file/services/), [volumes](https://docs.docker.com/reference/compose-file/volumes/), [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/), [docker compose up](https://docs.docker.com/reference/cli/docker/compose/up/), [docker compose exec](https://docs.docker.com/reference/cli/docker/compose/exec/) e [psql](https://www.postgresql.org/docs/18/app-psql.html).

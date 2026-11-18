# Interface web

A aplicação contém o simulador em `/simulator`, o painel de leads em `/admin` e a página de login em `/login`. As duas telas usam HTML, CSS e TypeScript sem framework e consomem os contratos públicos de `@copilot-leads/shared` e a API HTTP local.

Os estilos ficam em `src/styles/`, organizados em tokens, regras globais, layout, componentes e estilos específicos do simulador e do Kanban. O build compila o TypeScript e copia essa pasta para `dist/styles/`, publicada pela API em `/assets/styles/`. O HTML servido nas duas rotas carrega os mesmos arquivos.

O tema inicial acompanha a preferência do sistema; a escolha manual é salva no `localStorage`. O frontend não inclui dados mockados nem substitui as chamadas da API.

Cards podem apresentar intenção, serviço, período, resumo, revisão, origem e status da qualificação. **Simulada (sem IA externa)** é identificada explicitamente; o frontend nunca recebe chave ou SDK Gemini. Todos os campos são renderizados com `textContent`, inclusive dados provenientes do qualificador. A ausência de qualificação (por exemplo, opção 3) mantém o card funcional.

Cards Novo/Qualificado em conversas elegíveis oferecem **Assumir atendimento**, com POST para `/api/demo/leads/:id/assume`. Em atendimento humano, as ações **Ganho/Perdido** pedem confirmação e enviam POST para `/api/demo/leads/:id/close`. A interface muda somente após confirmação da API e bloqueia cliques repetidos durante o pedido. O filtro **Mostrar encerrados** apresenta resultados e mantém acesso ao histórico; o botão WhatsApp permanece disponível. Não há login, atribuição a um usuário ou movimentação livre.

`npm run check` na raiz também executa os testes de eventos/estado com DOM mínimo e a conferência dos estilos copiados. Esses testes não substituem a revisão visual em navegador.

O login (`login.html` e `src/login.ts`) é uma página separada, sem polling, que reutiliza os estilos e o tema (`src/styles/login.css` só ajusta o layout). Envia `POST /api/auth/login` e, em sucesso, vai para o `next` permitido (`/admin` ou `/simulator`; qualquer outro valor vira `/admin`). Em 401, mostra "Usuário ou senha inválidos." e limpa a senha. No simulador e no painel, qualquer 401 interrompe o polling e leva a `/login?next=<rota atual>`; o cabeçalho mostra o nome do atendente (`GET /api/auth/me`) e o botão **Sair** (`POST /api/auth/logout`). O cookie de sessão é `HttpOnly`: o JavaScript da página nunca vê o token.

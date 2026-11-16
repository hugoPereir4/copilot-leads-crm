# Interface web

A aplicação contém o simulador em `/simulator` e o painel de leads em `/admin`. As duas telas usam HTML, CSS e TypeScript sem framework e consomem os contratos públicos de `@copilot-leads/shared` e a API HTTP local.

Os estilos ficam em `src/styles/`, organizados em tokens, regras globais, layout, componentes e estilos específicos do simulador e do Kanban. O build compila o TypeScript e copia essa pasta para `dist/styles/`, publicada pela API em `/assets/styles/`. O HTML servido nas duas rotas carrega os mesmos arquivos.

O tema inicial acompanha a preferência do sistema; a escolha manual é salva no `localStorage`. O frontend não inclui dados mockados nem substitui as chamadas da API.

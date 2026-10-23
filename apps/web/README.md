# Dashboard

Esta aplicação conterá o painel usado pelos atendentes da clínica. Ela consumirá a API HTTP e os contratos públicos de `@copilot-leads/shared`.

A configuração TypeScript reconhece as APIs do navegador e usa resolução de módulos compatível com um futuro bundler. Os tipos globais do Node não são incluídos neste pacote.

Na etapa 3, `src/index.ts` apenas permite verificar e compilar a estrutura inicial. O script `build` atual compila TypeScript; a interface React e o empacotamento do frontend serão implementados na etapa do painel.

# Backend

Esta aplicação conterá o servidor Express e os módulos do monólito modular. O worker também executará no backend na v1.

A aplicação pode depender dos contratos públicos de `@copilot-leads/shared`. Os contratos não dependem desta aplicação. Os tipos do Node estão habilitados apenas neste ambiente.

Na etapa 3, `src/index.ts` é um ponto de entrada vazio para verificar a configuração TypeScript. O servidor HTTP e as regras de negócio serão construídos nas próximas entregas.

O campo `exports: {}` declara que esta aplicação não oferece uma interface de pacote para importação pelo dashboard. As fronteiras entre os futuros módulos também precisarão ser respeitadas no código e na revisão.

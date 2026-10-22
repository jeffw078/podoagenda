# Segregação de perfis e fluxo clínico

O prompt anexado pede autorização no servidor, respostas mínimas, encapsulamento do JavaScript, montagem real de telas autorizadas, status anônimo sem usuários e melhorias clínicas. O usuário confirmou manter **Finança Fácil e o logo atual**, prevalecendo sobre a seção de branding do anexo.

## Contrato de segurança

- Sessão HttpOnly define identidade/perfil/capacidades no servidor. `me`, login, troca de senha e cadastro retornam somente `transactions` e `finance` para contas pessoais; campos de consultório ficam no banco e nunca são enviados nesse documento pessoal.
- `save` pessoal aceita apenas o documento financeiro. Qualquer campo `clients`, `services`, `appointments` ou `settings` enviado por esse caminho retorna 403, sem gravação. O servidor mescla campos financeiros permitidos com o documento armazenado, preservando os dados anteriores.
- `status` público retorna somente `{registered:boolean, setupAvailable:boolean}`. O login usa username sem enumeração ou escolha de perfil no cliente.
- A permissão administrativa do Jefferson continua explícita e separada. O dashboard recebe projeções financeiras, contagem de agenda e configurações autorizadas; não recebe cadastros de clientes nem relatos/anamneses. A edição administrativa continua restrita ao servidor, com revisão por conta.
- Front-end ES modules com estado fechado e eventos via listeners/delegação. Nenhum estado, ação de consultório ou atalho de teste ficará exposto em `window`. Navegação usa capacidades da sessão recebida e renderiza apenas telas autorizadas. Templates clínicos são carregados somente para Podologia; contas pessoais não têm esses nós no DOM.

## Contrato clínico

`client.anamnesis = {diabetes:'none'|'type1'|'type2',hypertension:boolean,circulationProblems:boolean,anticoagulants:boolean,allergies:string}`. Campos opcionais em registros antigos, normalizados ao editar. Limite de 2000 caracteres nas alergias; validação no servidor para tipos e valores.

Agenda exibe avisos de diabetes/hipertensão conforme os dados cadastrados, sem inferir diagnósticos. Concluir atendimento salva relato e abre recebimento com valor preenchido; pagamento já registrado não é duplicado e compromissos pessoais continuam sem caixa. WhatsApp abre mensagem com nome/data/hora e `encodeURIComponent`. Escape fecha modal, com foco retornando ao acionador.

## Verificação

Testar diretamente HTTP: status anônimo, projeções pessoais em todos os fluxos de sessão, 403 em tentativas de manipular consultório, persistência e revisão preservadas, privilégios administrativos por identidade. Em Chrome: ausência de nós clínicos para personal; variáveis/funções inacessíveis no global; tentativas do bypass relatado não criam tela; anamnese, risco, recebimento, mensagem WhatsApp e Escape. Confirmar os três usuários existentes sem alterar dados reais durante os testes.

## Organização e execução

- `lib/access-control.js` concentra projeções e regras de acesso; `api/index.js` aplica essas regras com a identidade da sessão antes de gravar. Nenhuma migração ou exclusão de registros é necessária.
- `app.js`, `finance-ui.js` e `dashboard-ui.js` são as fontes do módulo privado `app.bundle.js`. `npm run build` gera esse arquivo e converte eventos declarativos; a Vercel executa o mesmo build.
- `ui-actions.js` interpreta somente comandos de uma lista explícita com argumentos literais, sem `eval` ou `Function`. A CSP impede scripts e manipuladores JavaScript inline. `views/` contém as telas montadas conforme a sessão; `clinic-features.js` é importado apenas no perfil clínico.
- A saída bloqueia ações imediatamente e espera a fila de salvamentos. Cada salvamento verifica a geração da sessão antes da requisição e ao receber a resposta, evitando reaproveitar dados de outra conta.
- `npm test` valida API com PostgreSQL local, regras financeiras, autenticação, anamnese e eventos. `npm run test:browser` usa Chrome/Chromium com a CSP de produção e interações nativas de DOM, sem expor atalhos ou estado da aplicação.
- `scripts/verify-personal-account.mjs` verifica o usuário de avaliação em produção, usando credenciais locais ignoradas pelo Git: payload financeiro, proibições HTTP 403, dados/revisão intactos e encerramento da sessão de teste.

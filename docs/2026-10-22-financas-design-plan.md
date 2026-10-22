# Finanças pessoais, configurações e visão geral — plano de execução

Objetivo: implementar o pedido de contas/recorrências/reservas/saldo auditável, experiência pessoal do Jefferson e painel de ambos os ambientes restrito a ele. Manter dados, agenda, histórico e parcelas existentes. Sem deploy ou alterações no banco de produção nesta entrega.

## Decisões de funcionamento

- Cada perfil mantém seu documento e sua revisão. `finance` é opcional em documentos antigos e é inicializado sem apagar transações.
- Contas possuem valor previsto (pode ser desconhecido), valor pago e vencimento. Pagar gera uma única transação, preservando o valor previsto; repetir o pagamento é rejeitado.
- Recorrências mensais fixas ou variáveis geram uma conta por regra/mês. Dia 31 é ajustado ao último dia de meses curtos. Editar a regra não altera contas já pagas.
- Reserva por mês: valor fixo ou percentual da renda mensal prevista informada no mesmo cadastro. Gera uma conta da categoria Reserva. Reserva paga reduz o disponível e aparece separada dos gastos de consumo.
- Saldo atual é um ponto inicial com data e base das movimentações já contabilizadas. Alterações posteriores criam ajustes com motivo obrigatório; não criam receita/despesa. O servidor preserva o histórico e o ponto inicial.
- A janela de despesa tem guias Contas e Gastos. Remover OCR e todos os botões/funções de importação/exportação JSON. Preservar cálculo de centavos e parcelas de gastos existentes.
- Acesso por usuário e senha, sem seleção de perfil nem botões Podologia/Pessoal/Bloquear após entrar. O nome do usuário determina o perfil; saudação pessoal para Jefferson. Configurações oferece saída da sessão, sem botão Bloquear no cabeçalho.
- Jefferson acessa o dashboard pela própria Configurações. Layout amplo no desktop, adaptável ao celular. Visão de ambos os ambientes e cadastros financeiros, horários e serviços por ambiente. Permissão verificada no servidor, com revisão por perfil.

## Contrato compartilhado

`finance-core.js` é um script universal que define `globalThis.FinanceCore`; funciona carregado antes do JS da página e como import de efeito colateral no Node. Sem dependências.

`finance = {version:1, openingBalance:null|{amount,date,baseline}, adjustments:[], monthlyPlans:[], recurringBills:[], bills:[]}`.

- Ajuste: `{id,date,delta,before,after,reason,createdAt}`.
- Plano: `{month,expectedIncome,reserveMode:'amount'|'percentage',reserveValue,reserveDueDay}`.
- Recorrência: `{id,description,category,fixed:boolean,expectedAmount:number|null,dueDay,startMonth,endMonth:null|string,active:boolean}`.
- Conta: `{id,month,dueDate,description,category,expectedAmount:number|null,paidAmount:number|null,status:'pending'|'paid'|'cancelled',source:'manual'|'recurring'|'reserve',sourceId:null|string,transactionId:null|string,paidDate:null|string}`.
- Transação de conta paga conserva o formato atual e acrescenta `billId` e `financeKind:'bill'|'reserve'`. Transações antigas sem campo continuam válidas.

Funções públicas (mutação apenas onde indicado, valores em reais com centavos arredondados):

1. `ensure(data)` inicializa e retorna `data.finance`.
2. `syncMonth(data, month)` gera/atualiza apenas contas pendentes do mês e retorna contas desse mês; idempotente.
3. `setMonthPlan(data, month, {expectedIncome,reserveMode,reserveValue,reserveDueDay})` salva e sincroniza.
4. `saveRecurring(data, input)` cria/edita a recorrência, retornando-a; IDs existentes devem ser preservados.
5. `createBill(data, input)` cria uma conta avulsa; `cancelBill(data,id)` cancela apenas pendentes.
6. `payBill(data,id,{amount,date,method})` grava pagamento e uma transação e retorna a conta; não duplica.
7. `currentBalance(data, asOf)` usa ponto inicial, transações até a data e ajustes; valores futuros não afetam disponível atual.
8. `setCurrentBalance(data, amount, date, reason='')` cadastra ponto inicial ou acrescenta ajuste com motivo.
9. `monthlySummary(data,month,asOf)` retorna `{income,spending,billsPaid,reserved,pending,pendingUnknown,reserveExpected,balance,freeAfterBills}`. `spending` exclui contas e reserva; `billsPaid` exclui reserva; `pending` inclui reserva ainda não paga. Quantias desconhecidas são sinalizadas por `pendingUnknown`.
10. `validateFinance(data)` retorna booleano, aceita documentos legados sem finance.
11. `validateFinanceChange(previous,next)` retorna booleano; exige ponto inicial e ajustes anteriores imutáveis e motivo nos novos ajustes.

API: `adminOverview` retorna `{accounts:[{profile,username,data,revision}]}` somente para usuário `jefferson`, perfil `personal`, senha definitiva. `adminSaveSettings` recebe `{targetProfile,revision,settings?,finance?,services?}` e retorna `{data,revision}`. Preserva clientes, agenda e transações do perfil de destino, valida dados e rejeita revisão obsoleta. Login passa a aceitar `username` sem `profile`, mantendo compatibilidade com chamadas antigas.

## Divisão e verificações

- [x] Agente núcleo: `finance-core.js`, testes de geração mensal, arredondamento, meses curtos, pagamentos, reserva e saldo/auditoria. Escrever testes falhando antes da implementação.
- [x] Agente API: validação financeira, endpoints de dashboard, login por usuário e testes PostgreSQL de permissões, isolamento, revisão e auditoria. Arquivos `api/index.js` e testes API, sem alterar index.
- [x] Agente telas financeiras: `finance-ui.js`, `finance-ui.css`, testes próprios; interface de contas, gastos, reserva, recorrências e configurações. Usa núcleo e helpers existentes, sem editar index.
- [x] Coordenador: shell/autenticação/navegação em index; remover OCR/JSON; integrar telas; dashboard e configurações dos dois ambientes em `dashboard-ui.js`; documentação e teste integrado.
- [x] Revisão independente após integração e suíte completa `npm.cmd test`; verificar conta variável sem previsão, mudança de mês, duplicidade, motivo de correção, usuário Raquel impedido do dashboard e compatibilidade da agenda.

Validação final: suíte completa passou; teste real no Chrome headless passou para navegação, formulários, saldo, reserva percentual/pagamento, gasto, recorrência variável, configuração do outro ambiente e layout móvel. Capturas locais em `.browser-check/desktop-dashboard.png` e `.browser-check/mobile-personal.png`. Revisões corrigiram vínculos de pagamentos, sincronização de meses, concorrência de gravação no painel e validação da auditoria. Nenhuma operação no banco de produção ou publicação foi executada.

Revisão: preços/dados antigos permanecem válidos; configuração pode acontecer em ambos os ambientes; nenhum acesso público ao outro perfil; nenhuma edição de senha ou segredo incluída no dashboard. O saldo exibido não é uma consulta bancária automática, mas o valor cadastrado atualizado pelos lançamentos.

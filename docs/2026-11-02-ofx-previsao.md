# OFX Nubank e previsão do mês seguinte

Solicitação: substituir os gastos de outubro de Jefferson pelo OFX com vencimento em 7/11 e mostrar, no início, a comparação das entradas previstas e despesas já comprometidas do mês seguinte. Em 2/11, o filtro inicial deve ser dezembro de 2026.

A renda do planejamento anterior serve de estimativa para um mês futuro enquanto ele não tiver planejamento próprio. A estimativa aparece identificada na tela e não cria receita, planejamento ou reserva. Um planejamento do mês selecionado, inclusive com renda zero, prevalece.

## Importação

- `lib/nubank-ofx-import.js` interpreta o OFX de cartão em reais, usando centavos inteiros e datas locais. Aceita tags SGML sem fechamento. Um FITID compartilhado entre compra e IOF mantém ambos os itens; uma repetição idêntica é rejeitada.
- `scripts/import-nubank-ofx.mjs` faz prévia por padrão. `--apply` salva backup privado, grava somente a conta pessoal de Jefferson com controle de revisão e relê o documento completo para conferir.
- A substituição remove despesas de caixa de outubro e detalhes da fatura Nubank de novembro, com auditoria de cada remoção. Outros cartões, parcelas de faturas futuras, recorrências, renda e saldo inicial permanecem. Se houver pagamento de conta/reserva entre as despesas ou compra misturando parcelas futuras, a operação exige conciliação em vez de adivinhar.
- As compras entram como cobranças da fatura de novembro. O arquivo não cria parcelas futuras nem transforma pagamentos de cartão em renda. O saldo de caixa conhecido é preservado por uma correção com motivo no histórico.
- Diferenças de até cinco centavos entre as cobranças e o total declarado ficam em um lançamento explícito de conciliação. Pagamentos anteriores do cartão ficam fora das compras.
- Categorias reconhecem estabelecimentos e aproveitam classificações existentes; nomes sem indicação suficiente ficam em Outros. O recibo mantém os lançamentos importados e impede reaplicação silenciosa ou duplicação. Gravações normais não podem reescrever esse recibo.

## Tela inicial

O filtro inicial já passa ao mês seguinte em `initializeViewDates()`. Os cartões principais passam a mostrar entradas previstas, gastos já previstos, saldo previsto do mês e saldo de hoje. Os indicadores continuam comparando entradas e saídas do mês escolhido. O cálculo gera as recorrências em uma cópia dos dados, permitindo previsão correta mesmo antes de o mês ter sido aberto; não altera dados ao consultar.

## Validação

`check-ofx-import.mjs`: OFX SGML, IOF com FITID compartilhado, centavos, datas inválidas, créditos desconhecidos, substituição com auditoria, preservação de saldo e contas futuras, reaplicação.

`check-finance-forecast.mjs`: dezembro, virada do ano, renda estimada identificada, planejamento zero com prioridade, despesas recorrentes ainda não geradas e renderização dos valores.

Executar `npm test`, conferir prévia real e gravar somente após esses checks. O histórico original permanece no backup privado e na auditoria; não incluir extratos ou credenciais no Git.

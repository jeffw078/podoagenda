# Easy Finance: indicadores, despesas e tarefas

Os controles financeiros são os mesmos para Jefferson e Raquel. O usuário de avaliação mantém seus próprios dados financeiros e tarefas, sem acesso ao dashboard. A identidade foi atualizada para Easy Finance, preservando o ícone atual.

## Interface financeira

Entrada e Saídas ficam no cabeçalho do controle financeiro. Despesas abre primeiro Gastos diários, seguido de Contas do mês. Não há criação de conta avulsa nem categoria personalizada no formulário de gastos. As contas existentes continuam acessíveis e as recorrências são configuradas normalmente.

A Reserva mostra os valores efetivamente registrados e seu histórico. A meta é definida em Configurações e gera uma conta mensal, também exibida na relação de contas fixas/recorrentes. O indicador acumulado calcula o total reservado menos a soma das metas mensais cadastradas até o mês de referência, limitado ao mês atual.

Os gráficos de início comparam o maior valor entre renda planejada e entradas lançadas com saídas lançadas e contas pendentes conhecidas do mês. Pagamentos atrasados pertencem ao mês do pagamento; faturas pagas não são somadas novamente como pendentes. O resumo informa contas sem previsão. Categorias incluem parcelas do crédito no mês da fatura e excluem a reserva e o pagamento duplicado da fatura.

Os limites de uso são definidos por cartão e mês em Configurações ou no dashboard. O formulário de compra mostra quais meses excedem o limite; o aviso não impede o registro. O início também mostra excessos do mês selecionado.

## Exclusão administrativa

Configurações → Abrir dashboard → Gerenciar despesas contém compras de cartão, saídas e pagamentos de cada ambiente. A operação exige motivo, sessão de Jefferson e revisão atual da conta. O servidor registra autor, horário e cópia do lançamento removido. Gravações normais não podem remover/alterar despesas anteriores nem modificar esse histórico.

Excluir uma compra no crédito recalcula as faturas pendentes e preserva faturas pagas/canceladas e pagamentos já realizados. Excluir o pagamento de uma conta devolve essa conta ao estado pendente. Nenhum lançamento existente é removido automaticamente por esta atualização.

## Tarefas

O botão TODO substitui as iniciais do avatar. Jefferson e Raquel compartilham a mesma lista. Outros usuários recebem listas isoladas. Cada tarefa tem título, prazo opcional e identidade/horário de criação; a conclusão é permanente, com autor e horário definidos pelo servidor, exibidos no fuso America/Sao_Paulo.

`studio_task_lists` guarda as listas em JSONB com revisão independente das finanças. O escopo é definido exclusivamente pela sessão: `owners` para Jefferson/Raquel e `account:<id>` para outras contas. A tabela é criada pela inicialização idempotente de `schema.sql`, sem reescrever contas existentes.

## Verificação

`npm test` inclui projeções e permissões da API com PostgreSQL local, limites, projeções de caixa, exclusões com auditoria, tarefas compartilhadas/isoladas e conclusão imutável. `npm run test:browser` usa interações nativas de DOM com CSP de produção e não expõe estado privado da aplicação.

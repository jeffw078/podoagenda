# Paridade financeira dos perfis e faturas de cartão

O pedido é que Raquel e Jefferson tenham o mesmo controle financeiro (contas, gastos, reserva, recorrências, saldo e correções); Raquel também possui agenda/clientes. Os dados financeiros de cada usuário permanecem individuais. O dashboard conjunto continua exclusivo do Jefferson.

## Interface

- Reutilizar a mesma função de renderização financeira nos containers de Raquel e Jefferson, com o mês próprio de cada tela. Mesmos cards, ações, contas e histórico.
- Guias Reserva e Configurações disponíveis para ambos. Raquel acessa seu controle pela navegação Finanças; suas Configurações mantêm acesso aos serviços e horários.
- Gastos no crédito exigem cartão `nubank` ou `mercado_pago`, preservando parcelas e escolha do mês da primeira fatura. Débito/dinheiro continuam como transações avulsas.
- Cartões aparecem previamente na lista de recorrências e nas contas mensais. Previsão da fatura = valor base adicional configurado na recorrência + parcelas das novas compras daquele cartão/mês. Mostrar banco nos detalhes da compra e da fatura.
- Compra no crédito não gera transação de caixa imediatamente. Pagamento da fatura gera uma só saída, evitando duplicação. Compras ficam em histórico específico de crédito. Transações antigas sem cartão identificado permanecem com sua contabilização original; não adivinhar banco nem duplicar lançamentos.

## Contrato de dados e núcleo

`finance.creditPurchases` é opcional em documentos antigos e inicializa como array vazio. Campos de compra: `{id,cardId,description,category,purchaseDate,amount,items,installments}`. Cada parcela conserva `{date,amount,installmentNumber,installmentCount}` do planejador já existente. Datas das parcelas são primeiro dia do mês; meses consecutivos, número de parcelas entre 1 e 120, soma em centavos exatamente igual ao total, sem valores nulos/negativos. Mês inicial não antecede a compra.

Novas funções públicas em `FinanceCore`:

- `ensureCreditCards(data, month)`: cria regras de recorrência ausentes, com IDs estáveis `card:nubank` e `card:mercado_pago`, marca opcional `cardId`, nomes Cartão de crédito · Nubank/Mercado Pago, categoria Cartão de crédito, previsão-base zero, variável, ativa, vencimento dia 10 e início no mês fornecido. Preserva configurações existentes. A escolha do dia pode ser editada nas recorrências.
- `recordCreditPurchase(data, {cardId,description,category,purchaseDate,amount,items,installments})`: valida todos os campos e parcelas antes de mutar; cria compra e sincroniza todos os meses afetados; não cria transações. Rejeita adicionar parcela em fatura já paga ou cancelada, com mensagem para escolher outro mês inicial.

As recorrências reconhecem opcionalmente cardId, que só aceita os dois identificadores. `syncMonth` soma compras às regras desses cartões. Compras existentes continuam gerando obrigação mesmo se a recorrência for pausada ou seu intervalo alterado; base configurada aplica-se somente aos meses em que a regra está ativa. Faturas pagas/canceladas preservadas. Não permitir dois cadastros para o mesmo cartão. IDs gerados de faturas continuam o padrão recorrente existente.

Validação no servidor pelo núcleo compartilhado: compras válidas, sem remoção de compras anteriores, valores/meses válidos e sem redefinir o cartão de uma regra existente. Regra de cartão com compras anteriores não pode ser excluída. Documentos antigos continuam válidos. Validadores não devem alterar os documentos durante a checagem.

## Ajustes adicionais solicitados

- Editar mês/valor de parcelas existentes em aberto, a partir do mês atual em `America/Sao_Paulo`, preservando quantidade, ordem e identificação da compra/cartão. Permitir intervalos entre meses após renegociação. O novo total é a soma exata das parcelas, inclusive as preservadas.
- `editCreditInstallments` faz alteração atômica, recalcula faturas dos meses antigos/novos e registra `finance.creditEdits`: identificação, compra, data, instante, motivo e snapshots antes/depois de total/parcelas. O servidor exige a trilha correspondente, preserva auditorias anteriores e rejeita mudanças em faturas pagas/canceladas e meses passados. Alterações não criam saídas de caixa.
- No dashboard exclusivo do Jefferson, cada ambiente possui **Cartões · parcelas futuras**, com edição de mês/valor e motivo. Salvar usa a revisão do perfil alvo e preserva suas transações/agenda e o outro ambiente.
- Excluir serviço sem uso remove o cadastro. Quando vinculado a um atendimento, marcar `archived:true`, esconder no catálogo, sugestões e novos agendamentos, preservando acesso pelo atendimento existente e seu histórico. O dashboard também oferece exclusão.

## Verificação executada

- Suíte de núcleo, interface, API PostgreSQL em memória, agenda, serviços e dashboard; testes de parcelas/auditorias/pagamentos e isolamento entre perfis.
- Chrome real com API local: dois usuários, cartões e parcelas, edição normal/admin, exclusão de serviço da Raquel com histórico, pagamento único, reserva e layout móvel. Não altera o banco de produção.

## Trabalho e verificação

- Núcleo/cartões: testes antes do código; centavos, separação de bancos/perfis, base+compras, parcelas/virada de ano, pagamento único, fatura encerrada, preservação de passado, dados inválidos.
- Interface/integração: mesma renderização por perfil, banco obrigatório no crédito, recorrências semeadas, detalhes de compras, compatibilidade de gastos à vista e saldo, configurações do dashboard preservando cardId.
- Testar API com novos documentos e rejeições financeiras, navegador real nos dois usuários, suíte completa. Depois, commit e push na main, seguindo a autorização persistente desta conversa.

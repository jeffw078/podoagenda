# Conciliação de extrato e fatura Nubank

`npm run bank:import -- --debit <extrato.csv> --credit <fatura.csv> --month AAAA-MM --due AAAA-MM-DD` gera uma prévia. `--offline` lê somente os arquivos. `--apply` grava a conciliação na conta pessoal do Jefferson, após criar um backup local privado e conferir a revisão da conta.

O escopo autorizado para o extrato bancário é somente **Compra no débito**. Entradas, Pix, boletos, pagamentos de fatura e aplicações são ignorados. No CSV do cartão, os pagamentos recebidos são ignorados: os itens positivos detalham a fatura indicada pelo vencimento, sem gerar parcelas adicionais nos meses futuros.

O detalhamento substitui o saldo agregado previamente cadastrado da fatura, evitando somar os itens novamente ao total. Se os itens não cobrirem todo o valor declarado, a diferença fica identificada como saldo não detalhado. Se ultrapassarem o total, a operação é rejeitada. Uma fatura paga, cancelada ou com outras compras/ajustes já detalhados também exige conferência antes de importar.

O saldo atual informado deve permanecer igual. As despesas históricas entram com as datas originais, e a diferença é conciliada por um ajuste explícito de saldo com motivo. O ponto inicial e os ajustes anteriores são preservados; nenhuma receita fictícia é criada.

O recibo da importação guarda os hashes dos arquivos, IDs dos lançamentos, cópia do saldo agregado substituído e os totais conferidos. Repetir os mesmos arquivos não duplica os lançamentos. Arquivos alterados ou itens anteriormente excluídos exigem revisão, sem recriação automática.

Os CSVs em `docs/` e os backups/resultados `.bank-import*.local.json` são ignorados pelo Git. Os testes usam dados fictícios e cobrem formato CSV, centavos exatos, exclusão de transferências/pagamentos, preservação de saldo e faturas futuras, idempotência e rejeição sem alterações parciais.

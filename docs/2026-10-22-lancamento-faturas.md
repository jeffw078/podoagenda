# Faturas anteriores e retirada de ajustes manuais

O usuário pediu para retirar o lançamento manual dos valores atuais do cartão e fornecer seu levantamento para cadastro assistido. Considerar novembro de 2026 como primeiro mês e a virada de ano em janeiro de 2027. O destino é o perfil pessoal do Jefferson.

Os valores ficam somente em `.card-invoices.local.json`, ignorado pelo Git. Há 20 vencimentos: 14 do Mercado Pago, sempre dia 17, e seis do Nubank, sempre dia 7. Os testes versionados usam valores fictícios.

## Comportamento

- Retirar o campo de valor adicional dos cartões e os botões/formulários de edição manual de parcelas, inclusive no dashboard. Preservar o núcleo de leitura/validação de auditorias antigas para não invalidar registros existentes.
- Preservar as novas compras, a escolha obrigatória de banco, o parcelamento automático e o pagamento único das faturas.
- Lançar saldos anteriores como compras identificadas com uma única parcela no mês correto, sem transação de caixa. A soma com compras conhecidas deve corresponder exatamente ao levantamento fornecido. Ajustar o vencimento da recorrência do banco e zerar o valor adicional anterior do cartão importado.
- Usar recibos estáveis por banco/mês para não repetir importações. Recusar divergências de um levantamento já importado e preservar compras/configurações feitas depois.
- Impedir gravação em banco vazio ou no perfil errado; proteger revisões, faturas encerradas e parcelas antigas não conciliadas. Fazer backup local antes do UPDATE e conferir a leitura após gravar.

## Acesso

A consulta com TLS usando os certificados do Windows confirmou que o Neon de `.env.local` está vazio e não possui as colunas de usuários do site. A API do site retorna Raquel/Jefferson. Não gravar no banco vazio nem criar contas para contornar a diferença. A conexão de produção precisa ser disponibilizada em `.env.local` para concluir o cadastro assistido.

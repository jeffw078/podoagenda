# Meu Studio — Neon (versão para Vercel)

Dois usuários com acesso por nome e senha: Raquel entra no consultório e Jefferson no controle pessoal. O navegador usa a API da Vercel; os dados ficam no PostgreSQL do Neon. Sem `DATABASE_URL` o app não consegue funcionar. O painel conjunto e a edição das configurações dos dois ambientes são exclusivos do Jefferson.

## Publicar

1. Crie um projeto Neon. Execute `schema.sql` no SQL Editor do Neon **uma vez**.
2. Envie os arquivos desta pasta a um repositório GitHub e conecte-o à Vercel (Framework: Other, diretório raiz: esta pasta).
3. Configure na Vercel em Settings > Environment Variables: `DATABASE_URL` = string PostgreSQL **pooler** do Neon; `SETUP_CODE` = código de criação de contas, aleatório e forte.
4. Faça deploy. Abra a URL HTTPS. Primeiro crie o perfil Podologia e depois o Pessoal com senhas distintas e `SETUP_CODE`; depois ambos acessam apenas com suas senhas. O código de configuração nunca deve aparecer em `index.html` nem ser commitado.
5. Os documentos atuais permanecem no banco. A versão nova inicializa o bloco financeiro ao entrar, preservando agenda, clientes e movimentações existentes. Migrações externas devem ser feitas pelo responsável pelo banco; não há importação ou exportação JSON na interface.
6. Remova `SETUP_CODE` do ambiente após criar ambas as contas e faça um novo deploy. Mantenha os backups do Neon.

## Inicializar o Neon

O schema é compatível com PostgreSQL do Neon: utiliza `gen_random_uuid()`,
`JSONB`, `TIMESTAMPTZ`, chaves estrangeiras e um índice de expiração.
Não exige instalar extensões. A integração Neon/Vercel fornece a conexão,
mas não executa o schema automaticamente.

Use Node.js 24 e instale as dependências com `npm ci`. Para inicializar
pela linha de comando, copie `.env.example` para `.env.local`, preencha
`DATABASE_URL` com a conexão do banco correto e execute `npm run db:init`.
O comando aplica o schema em uma transação e verifica a presença das duas
tabelas. A API também inicializa o schema automaticamente se uma consulta
encontrar tabelas ausentes (`42P01`), usando o banco/branch de `DATABASE_URL`
do deploy. Ela não importa dados de outro banco. O usuário da conexão precisa
ter permissão para criar as tabelas. O arquivo `schema.sql` é incluído na função
pela configuração da Vercel. Também é possível executar `schema.sql` no SQL Editor do Neon,
acessível pela área Storage da Vercel.

Os comandos `CREATE ... IF NOT EXISTS` permitem repetir a inicialização,
mas não atualizam a estrutura de tabelas que já existam com as mesmas
identificações. Este schema não importa os dados da versão anterior.

Na Vercel, configure `DATABASE_URL` e `SETUP_CODE` no ambiente do deploy.
Depois de alterar as variáveis, faça um novo deploy. `.env.local`, outros
arquivos de segredos e `.vercel/` ficam excluídos do Git.

Referências: [integração Neon/Vercel](https://vercel.com/marketplace/neon/neon)
e [UUID no PostgreSQL](https://www.postgresql.org/docs/current/functions-uuid.html).

## O que está implementado

- Raquel e Jefferson usam o mesmo controle financeiro: saldo disponível, contas pendentes, gastos, reserva, recorrências, correções de saldo e movimentações mensais. Os registros de cada usuário são individuais. Raquel também possui agenda e clientes. A navegação dá acesso a Despesas, Reserva e Configurações. Não há botões de troca de perfil ou Bloquear; o botão **Sair** fica no cabeçalho dos dois ambientes e também há saída em Configurações.
- Despesas com guias **Contas** (vencimentos e pagamentos) e **Gastos** (compras avulsas e parcelas). Contas recorrentes podem ser fixas ou variáveis, com previsão opcional nas variáveis. O pagamento registra o valor efetivo, preserva o previsto e gera apenas uma movimentação. Contas pagas não podem ter seu pagamento excluído isoladamente.
- Reserva mensal por valor fixo ou percentual da **renda prevista do mês**, informada no mesmo planejamento. A meta gera uma conta a pagar. O pagamento reduz o disponível e aparece separado dos gastos de consumo. Defina cada mês na guia Reserva ou em Configurações; editar a meta não reescreve pagamentos anteriores.
- Cadastro do saldo atual com data. Os lançamentos já registrados até essa data formam a base inicial; depois disso as movimentações atualizam o disponível. Corrigir exige motivo e gera um histórico com valor anterior, novo valor, diferença e data. O servidor rejeita alterações no ponto inicial ou em correções anteriores.
- Dashboard amplo para computador em **Jefferson → Configurações → Abrir dashboard**, com visão financeira dos dois ambientes e configurações de saldo, planejamento/reserva, recorrências e, no consultório, serviços e horários. A API verifica a identidade do Jefferson e a revisão de cada perfil antes de gravar. Os dados de clientes, agenda e transações do outro ambiente são preservados.
- OCR de cupom e as operações de importar/exportar JSON foram removidos.

- Ícone de agenda e dinheiro para o app salvo no celular: `manifest.json`, ícones PNG de 192 e 512 pixels, versão para iPhone de 180 pixels e favicon. O nome do atalho é **PodoAgenda**, com abertura em modo independente. Depois de publicar os arquivos, adicione o site à tela inicial pelo navegador; atalhos antigos podem precisar ser removidos e adicionados novamente para atualizar o ícone. Não inclui acesso offline: os dados continuam dependendo da API e do banco.

- Agenda do dia com cards para cada intervalo livre, antes, entre e depois dos atendimentos, respeitando o expediente e o almoço. Clicar em **Adicionar atendimento** preenche data e início; as sugestões mostram até três serviços que cabem no intervalo, usando as durações do catálogo. Clicar em uma sugestão também seleciona o serviço.
- Compromissos pessoais na mesma agenda pelo botão **+ Pessoal** ou pelo tipo do agendamento: título e duração, sem cliente, serviços ou pagamento. Podem ocorrer fora do expediente e durante o almoço, sem sobrepor outros compromissos. Os registros são preservados no banco; registros antigos continuam sendo atendimentos.

- Histórico de atendimentos dentro do cadastro de cada cliente, com data, serviços, duração, valor, status e relato. A conclusão abre um campo livre para descrever o que foi feito; o relato também pode ser incluído ou editado depois. Serviços são registrados com os nomes e valores da conclusão para preservar o histórico quando o catálogo mudar. O pagamento continua sendo registrado separadamente.

- Despesas com escolha obrigatória de débito, dinheiro ou crédito nos dois perfis. No crédito, escolha **Nubank** ou **Mercado Pago**, o número de parcelas (até 120) e o mês da primeira fatura. Cada parcela é somada à conta mensal do banco escolhido. As duas contas já aparecem nas recorrências; ajuste o vencimento em Configurações. Faturas encerradas rejeitam novas parcelas; escolha outro mês inicial.
- Compras no crédito têm histórico separado e não reduzem o disponível na compra. O pagamento da fatura em **Contas** gera uma única saída do saldo e preserva os valores previsto e pago. Débito e dinheiro continuam como despesas na data da compra. A divisão das parcelas preserva os centavos exatos.
- Os formulários de ajuste manual do valor adicional dos cartões e de edição de parcelas futuras foram removidos. As novas compras continuam alimentando as faturas automaticamente. Registros e auditorias existentes são preservados.
- Serviços da Raquel podem ser excluídos pelo cadastro ou pelo dashboard administrativo. Serviços sem uso são removidos; serviços vinculados a atendimentos saem do catálogo e das sugestões, preservando nome, valor e registros anteriores. Ao editar um atendimento existente, seu serviço anterior continua disponível.

- Usuários nomeados: Raquel acessa Podologia; Jefferson acessa Pessoal. Contas criadas com senha temporária exigem a troca no primeiro acesso, antes de liberar dados ou gravações.
- A criação inicial assistida usa uma autorização Ed25519 assinada, de curta duração. `scripts/manage-accounts.mjs prepare` guarda chave privada e senhas somente em `.account-setup.local.json`, ignorado pelo Git; apenas a chave pública é publicada. Após publicar essa chave, `provision` cria as duas contas sem substituir contas existentes; `check` testa os logins e encerra as sessões de teste. Nenhuma senha é incluída no código ou no repositório.

- Visual sóbrio em verde dólar, com superfícies neutras e menos elementos decorativos.
- Primeiro acesso sem senha padrão: cada perfil cria sua senha, confirma e usa o código de ativação definido pelo administrador em `SETUP_CODE`. Nos próximos acessos, basta a senha do perfil.
- Se a API estiver indisponível, a tela informa a falha e permite tentar novamente; ela não oferece criar uma conta sem conseguir verificar os perfis existentes.
- `npm test` verifica autenticação, agenda, histórico, parcelas, núcleo financeiro, interface e permissões do dashboard usando PostgreSQL local em memória (PGlite). Não acessa o banco de produção. `npm run test:browser` exercita os formulários e navegação em Chrome/Edge headless com uma API local de teste e salva capturas em `.browser-check/`, ignorada pelo Git. Use `BROWSER_PATH` se o navegador não estiver em um caminho conhecido.

- Duas contas isoladas pela sessão autenticada; a exceção é o painel administrativo autorizado do Jefferson.
- Financeiro nos dois espaços: entradas, despesas com linhas detalhadas, categorias e agrupamento por mês; gráficos por categoria.
- Podologia: clientes, serviços, agenda, bloqueio de almoço de pelo menos 60 minutos e encaixes.
- Sessão HttpOnly, Secure e SameSite=Lax. Senhas com `scrypt` e salt único. Bloqueio temporário após oito senhas incorretas. Proteção de edição simultânea por revisão; conflitos geram alerta para recarregar.

## Lançamento assistido de faturas anteriores

O arquivo privado `.card-invoices.local.json` contém `username`, `capturedDate` e uma lista `invoices` com `cardId`, `month`, `amount` e `dueDate`. Esse arquivo e os backups estão ignorados pelo Git; valores pessoais não fazem parte do código publicado.

`npm run cards:import -- --offline` confere o arquivo. `npm run cards:import` prepara a prévia no Neon configurado. `npm run cards:import -- --apply` grava somente na conta pessoal do Jefferson, criando backup local e conferindo a revisão. A conexão deve apontar para o banco do site, com essa conta já cadastrada. A ausência da conta interrompe a operação.

O lançamento usa os totais de cada fatura como referência e desconta as compras já cadastradas naquele banco/mês, evitando somá-las duas vezes. Novas compras posteriores continuam somando normalmente. Faturas pagas/canceladas, valores já importados divergentes e parcelas antigas sem identificação do banco exigem conciliação antes da gravação. Repetir o mesmo arquivo não duplica as faturas nem desfaz compras posteriores.

## Limites desta entrega

- Os lembretes automáticos por WhatsApp ainda não estão implementados. O botão existente apenas abre uma conversa para envio manual. A proposta é usar a API oficial do WhatsApp Business e uma rotina no servidor para lembretes de 24 horas e 1 hora antes, com autorização da cliente, modelos aprovados, verificação de cancelamentos/reagendamentos e registro dos envios para evitar duplicidade. A rotina deve usar `America/Sao_Paulo`, ignorar compromissos pessoais e funcionar com o navegador fechado. O [cron do plano Hobby da Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing) só executa uma vez por dia e sem precisão de minuto; seria necessário um agendador externo ou um plano com execução frequente. A ativação também depende do número conectado à API, das credenciais e dos modelos aprovados pela Meta. Consulte a [política oficial de mensagens](https://business.whatsapp.com/policy?lang=pt_BR).

- Esta entrega é **código para deploy**, não um deploy concluído nem migração dos dados anteriores. É necessário instalar no projeto oficial e configurar Neon.
- A gravação salva um documento JSON por perfil no PostgreSQL, não tabelas independentes de transações e atendimentos. Adequado a um uso pequeno, mas sem sincronização ao vivo: alterações simultâneas em vários aparelhos podem gerar conflito e exigir recarga.
- Não inclui login por digital/passkey; isso exigirá WebAuthn completo e política de recuperação.
- Não inclui armazenamento de fotos ou anexos persistentes.
- O saldo disponível é o valor cadastrado atualizado pelos lançamentos; não existe conexão automática com banco ou cartão. Contas sem valor previsto são sinalizadas e não entram na estimativa numérica até o valor ser conhecido. Compras antigas no crédito, cadastradas sem identificação do banco, mantêm sua contabilização original e não são somadas novamente às novas faturas.
- Configure na Vercel e Neon backup automático, limite de gastos, monitoração e autenticação adicional caso evolua para uso amplo.

## Segurança

`DATABASE_URL` contém segredo. Use APENAS variável do ambiente de execução Vercel; não exponha no JS servido para usuários. Se credenciais do banco já foram copiadas em mensagens ou no código público, rotacione-as no Neon antes da publicação. Separe desenvolvimento de produção e restrinja acesso ao projeto.

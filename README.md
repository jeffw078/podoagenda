# Meu Studio — Neon (versão para Vercel)

Dois perfis com login separado: Podologia e Pessoal. O navegador usa API do Vercel; os dados ficam no PostgreSQL do Neon. Sem `DATABASE_URL` o app não consegue funcionar. O OCR com Tesseract.js depende de carregar a biblioteca e os modelos pela internet.

## Publicar

1. Crie um projeto Neon. Execute `schema.sql` no SQL Editor do Neon **uma vez**.
2. Envie os arquivos desta pasta a um repositório GitHub e conecte-o à Vercel (Framework: Other, diretório raiz: esta pasta).
3. Configure na Vercel em Settings > Environment Variables: `DATABASE_URL` = string PostgreSQL **pooler** do Neon; `SETUP_CODE` = código de criação de contas, aleatório e forte.
4. Faça deploy. Abra a URL HTTPS. Primeiro crie o perfil Podologia e depois o Pessoal com senhas distintas e `SETUP_CODE`; depois ambos acessam apenas com suas senhas. O código de configuração nunca deve aparecer em `index.html` nem ser commitado.
5. Na versão antiga, exporte os dois arquivos JSON separadamente. Entre em cada perfil novo e use **Importar JSON** para recuperar o conteúdo correspondente. Importar substitui todos os dados do perfil selecionado.
6. Remova `SETUP_CODE` do ambiente após criar ambas as contas e faça um novo deploy. Mantenha os backups do Neon e exportações periódicas.

## O que está implementado

- Duas contas independentes e isoladas pela sessão autenticada no servidor.
- Financeiro nos dois espaços: entradas, despesas com linhas detalhadas, categorias e agrupamento por mês; gráficos por categoria.
- Podologia: clientes, serviços, agenda, bloqueio de almoço de pelo menos 60 minutos e encaixes.
- OCR via Tesseract.js no navegador, com revisão manual obrigatória antes de salvar.
- Sessão HttpOnly, Secure e SameSite=Lax. Senhas com `scrypt` e salt único. Bloqueio temporário após oito senhas incorretas. Proteção de edição simultânea por revisão; conflitos geram alerta para recarregar.
- Exportação e importação JSON.

## Limites desta entrega

- Esta entrega é **código para deploy**, não um deploy concluído nem migração dos dados anteriores. É necessário instalar no projeto oficial e configurar Neon.
- A gravação salva um documento JSON por perfil no PostgreSQL, não tabelas independentes de transações e atendimentos. Adequado a um uso pequeno, mas sem sincronização ao vivo: alterações simultâneas em vários aparelhos podem gerar conflito e exigir recarga.
- Não inclui login por digital/passkey; isso exigirá WebAuthn completo e política de recuperação.
- Não inclui armazenamento de fotos no Neon nem anexos persistentes. OCR lê a imagem, mas só salva os itens digitados/reconhecidos.
- Configure na Vercel e Neon backup automático, limite de gastos, monitoração e autenticação adicional caso evolua para uso amplo.

## Segurança

`DATABASE_URL` contém segredo. Use APENAS variável do ambiente de execução Vercel; não exponha no JS servido para usuários. Se credenciais do banco já foram copiadas em mensagens ou no código público, rotacione-as no Neon antes da publicação. Separe desenvolvimento de produção e restrinja acesso ao projeto.

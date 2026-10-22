# Conta pessoal adicional para avaliação

O usuário pediu uma conta pessoal para um amigo, com usuário e senha fornecidos, mesmos controles financeiros do Jefferson, dados próprios e sem dashboard. As credenciais ficam somente no arquivo local ignorado `.account-reviewer.local.json`.

- Permitir várias contas pessoais nomeadas, removendo somente a restrição antiga de unicidade global de `profile`. Manter unicidade de username, do consultório e de contas legadas sem username por perfil.
- Login pelo username e, quando enviado, pelo perfil correspondente. Sessões e gravações continuam vinculadas ao ID da conta. O cadastro inicial não permite recriar um perfil principal existente.
- O dashboard e a edição administrativa continuam restritos ao usuário Jefferson no perfil pessoal. Consultas administrativas selecionam explicitamente os dois usuários principais; uma segunda conta pessoal não pode ser confundida com Jefferson.
- O navegador identifica perfil pelo username, preserva os dados digitados no login e mostra o nome da pessoa conectada. A conta adicional tem os mesmos menus pessoais e nenhum acesso ao dashboard, mesmo por URL ou chamada direta à API.
- Criação assistida em transação com a migração, hash/salt e documento financeiro vazio. Recusar nomes reservados e alteração de contas existentes. Conferir os dados/revisões principais após a operação.
- Antes de inserir a terceira conta em produção, publicar e verificar a versão nova da API/interface para que clientes antigos não escolham a conta errada pelo perfil.

Validação: migração PostgreSQL em memória preservando documentos, autenticação de dois usuários pessoais, isolamento das gravações, falhas de login sem bloquear outro usuário, endpoints administrativos negados e teste em Chrome com saudação e navegação do avaliador. Após criar no Neon, conferir o login real e as permissões sem alterar finanças dos usuários principais.

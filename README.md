# Easy Finance

Controle financeiro com agenda e clientes para o consultório, API na Vercel e dados persistidos no PostgreSQL Neon.

| Pasta | Responsabilidade |
| --- | --- |
| `src/client/` | Interface, estilos e templates do navegador |
| `src/shared/` | Regras financeiras usadas pela API e pela interface |
| `public/` | HTML, manifest e ícones publicados |
| `public/assets/`, `public/views/` | Arquivos gerados pelo build, fora do Git |
| `api/`, `lib/` | Endpoint e serviços do servidor |
| `scripts/` | Build, verificações e ferramentas operacionais |
| `assets/source/` | Originais dos ícones, preservados fora da publicação |
| `docs/` | Registro das decisões anteriores; consulte o índice da pasta |

A Vercel executa `npm run build` e publica somente `public/`, além da função em `api/index.js`. `schema.sql` define as tabelas e é incluído na função do servidor. O build mantém o estado da aplicação privado em um módulo e converte os comandos de interface em eventos delegados, compatíveis com a CSP.

## Instalar e executar

Use Node.js 24 e instale as dependências travadas:

```sh
npm ci
npm run build
npm run dev
```

`npm run dev` inicia o app com o servidor de desenvolvimento da Vercel. Para trabalhar com banco local, copie `.env.example` para `.env.local` e defina `DATABASE_URL` para um banco PostgreSQL de desenvolvimento. `npm run db:init` aplica o schema ao banco indicado nesse ambiente. Confira o destino antes de executar o comando; não aponte os comandos locais para produção.

## Verificações

- `npm test` compila o app e executa as verificações usando PostgreSQL local em memória (PGlite). Não se conecta à produção.
- `npm run test:browser` compila o app e exercita os fluxos no navegador com uma API local de teste e Chrome/Edge headless. Defina `BROWSER_PATH` se o executável do navegador não for encontrado automaticamente. As capturas vão para `.browser-check/`, ignorada pelo Git.

## Perfis e funcionamento atual

- **Podologia (Raquel):** clientes, serviços, agenda e controle financeiro próprio.
- **Pessoal (Jefferson e contas pessoais adicionais):** controle financeiro isolado por conta. Tarefas são compartilhadas entre Jefferson e Raquel; contas adicionais têm listas próprias.
- **Administração:** somente Jefferson pode abrir o dashboard conjunto dos dois perfis principais. Contas pessoais adicionais não aparecem nele. A exclusão de despesas é restrita ao fluxo autorizado e registrada no histórico de auditoria.
- **Financeiro:** entradas, gastos diários, contas do mês, recorrências, limites de cartão, indicadores e correções de saldo com motivo. Metas de reserva são definidas em Configurações; a tela Reserva mostra os valores registrados e pagamentos.
- **Operação clínica:** agenda, compromissos pessoais, histórico de clientes, serviços e horários. Os lembretes do WhatsApp são enviados manualmente; o envio automático não está implementado.

O navegador usa a API para salvar dados. O app não sincroniza movimentações financeiras nem registros clínicos com bancos. As notas de planejamento arquivadas não descrevem necessariamente o comportamento atual; confira o código e as verificações.

## Scripts operacionais

As ferramentas de importação são operações de linha de comando, separadas da interface do app:

- `npm run bank:import -- --debit <statement.csv> --credit <invoice.csv> --month YYYY-MM --due YYYY-MM-DD` gera uma prévia da conciliação. `--apply` grava na conta pessoal selecionada pelo script; `--offline` processa arquivos locais sem se conectar ao banco.
- `npm run cards:import` gera uma prévia da importação de faturas históricas preparada. `--apply` grava na conta pessoal configurada.
- `npm run accounts:create-personal` gera uma prévia da criação de uma conta pessoal adicional; acrescente `-- --apply` para gravar.

Esses comandos podem exigir `.env.local` e arquivos de entrada privados. Não inclua credenciais, exportações, backups nem dados de clientes ou bancos no Git. Revise a prévia e confira o banco de destino antes de usar uma opção `--apply`.

Consulte [docs/README.md](docs/README.md) para ver as notas históricas do projeto e o status delas.

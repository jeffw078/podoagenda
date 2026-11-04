# Contatos e agendamentos recorrentes

Importar os contatos do VCF indicado como clientes do consultório, com nome e telefone, sem sobrescrever cadastros, anamnese, agenda ou financeiro. O arquivo privado e os backups não serão publicados no repositório. Duplicatas com mesmo nome e telefone normalizados não criam novos clientes; registros inválidos são relatados por contagem.

No formulário de agendamento, perguntar se o horário se repete. Oferecer semanal, quinzenal, mensal e intervalo personalizado em dias, semanas ou meses. A data final fica visível e pode ser escolhida ao agendar. A preferência entre data e quantidade foi perguntada; na ausência de resposta, usar data final, com sugestão de três meses que o usuário pode alterar.

Salvar ocorrências concretas, ligadas por identificador de série, na estrutura atual da agenda. Esta abordagem permite que disponibilidade, histórico e recebimentos continuem funcionando sem reservas invisíveis. Uma regra sem ocorrências exigiria alterar todos os leitores da agenda e o faturamento; cópias sem vínculo impediriam a edição da série. Por isso, ocorrências com vínculo são a escolha de implementação.

Editar ou excluir somente a ocorrência selecionada ou esta e as próximas. A exclusão cancela os horários, libera a agenda e mantém o histórico. Alterações em lote preservam ocorrências anteriores, concluídas, canceladas e com recebimentos. Recorrência não gera receita automaticamente.

Conferir todos os horários antes de alterar dados. Se qualquer ocorrência conflitar com atendimentos, compromissos pessoais, almoço ou expediente, informar a data e não salvar parte da série. Recorrências mensais mantêm o dia original, usando o último dia nos meses curtos. Usar datas civis, sem deslocamentos por fuso horário.

Limitar a série a 366 ocorrências e o documento ao limite já existente de 25.000 agendamentos. Preservar agendamentos antigos sem metadados. Não criar agendamentos reais a partir do arquivo de contatos: somente os clientes serão importados.

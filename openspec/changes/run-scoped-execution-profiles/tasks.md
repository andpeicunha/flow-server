# Tasks / Tarefas

- [x] **[us]** Define the local schema and validation for reusable execution profiles, including compatibility with current source-level execution settings.
  **[pt]** Definir o schema local e a validação dos perfis de execução reutilizáveis, incluindo compatibilidade com as configurações atuais na fonte.
- [x] **[us]** Resolve the selected profile when a run starts and persist its immutable execution snapshot and profile ID.
  **[pt]** Resolver o perfil selecionado no início da run e persistir seu snapshot imutável de execução e ID.
- [x] **[us]** Make node planning, retry, receipts, inspection, and audit use each run's selected profile rather than the source-wide runtime.
  **[pt]** Fazer planejamento de nodes, retry, receipts, inspeção e auditoria usarem o perfil selecionado em cada run, em vez do runtime global da fonte.
- [x] **[us]** Add a reviewed same-run profile-switch operation for rate-limited nodes; apply it to the pending node and all future uncompleted nodes and record a complete execution-history entry.
  **[pt]** Adicionar uma operação revisada para trocar o perfil da mesma run em nodes bloqueados por rate limit; aplicá-la ao node pendente e a todos os nodes futuros não concluídos e registrar a troca completa no histórico.
- [x] **[us]** Ensure concurrent runs from one source can select different profiles and remain isolated during mutations and checkpoints.
  **[pt]** Garantir que runs simultâneas de uma mesma fonte possam selecionar perfis diferentes e permaneçam isoladas em mutations e checkpoints.
- [x] **[us]** Update MCP, CLI, Herdr pane, and agent guidance to select a profile at run creation and switch it during recovery.
  **[pt]** Atualizar MCP, CLI, painel Herdr e orientações dos agentes para selecionar um perfil ao criar a run e trocá-lo durante a recuperação.
- [x] **[us]** Add contract, service, CLI, MCP, and concurrency coverage for selection, switching, history, and legacy configuration.
  **[pt]** Adicionar cobertura de contratos, serviço, CLI, MCP e concorrência para seleção, troca, histórico e configuração legada.
- [x] **[us]** Document that execution profiles do not switch provider credentials and require the active harness to be authenticated for the selected account.
  **[pt]** Documentar que perfis de execução não trocam credenciais do provedor e exigem que o harness ativo esteja autenticado na conta selecionada.

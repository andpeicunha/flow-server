# Tasks / Tarefas

- [x] **[us]** Derive the missing prior node execution for legacy runs from the pinned node and run runtime, and record it in switch history without changing completed receipts.
  **[pt]** Derivar a execução anterior ausente do node em runs legadas a partir do node fixado e do runtime da run, e registrá-la no histórico da troca sem alterar receipts concluídos.
- [x] **[us]** Resolve current-source profile candidates for legacy recovery only after validating the run's pinned flow, source, and workspace identity; label candidates as current-source data.
  **[pt]** Resolver perfis candidatos da fonte atual para recuperação legada somente após validar a identidade fixada de flow, fonte e workspace da run; identificar os candidatos como dados da fonte atual.
- [x] **[us]** Preserve the pinned legacy-fallback path and return `EXECUTION_PROFILE_REQUIRED` with actionable candidates when profiles exist but no profile ID is supplied.
  **[pt]** Preservar o caminho de fallback legado fixado e retornar `EXECUTION_PROFILE_REQUIRED` com candidatos acionáveis quando houver perfis, mas nenhum ID for informado.
- [x] **[us]** Extend retry inspection and public MCP/CLI guidance to distinguish current-source candidates from run-pinned profiles.
  **[pt]** Estender a inspeção de retry e as orientações públicas de MCP/CLI para distinguir candidatos da fonte atual de perfis fixados na run.
- [x] **[us]** Add regression coverage for legacy, profile-pinned, legacy-fallback, and no-alternative runs, including receipt preservation, history, attempt increments, and safety rejections.
  **[pt]** Adicionar cobertura de regressão para runs legadas, com perfil fixado, com fallback legado e sem alternativa, incluindo preservação de receipts, histórico, incremento de tentativa e rejeições de segurança.
- [x] **[us]** Validate the OpenSpec change and run the focused service, contract, MCP, and CLI checks for the affected behavior.
  **[pt]** Validar a mudança OpenSpec e executar as verificações focadas de serviço, contrato, MCP e CLI para o comportamento afetado.

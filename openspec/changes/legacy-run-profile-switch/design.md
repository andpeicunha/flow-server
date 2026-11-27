# Design / Design

## Decision / Decisão

[us] Keep legacy runs immutable. When `nodeExecutions[nodeId]` is absent, derive only the previous selection needed for the blocked node from the pinned node definition and `run.runtime`; do not backfill or rewrite unrelated node selections. Record that derived selection as the `from` side of the existing execution-history entry before applying the requested profile to the blocked node and remaining uncompleted nodes.

[pt] Manter runs legadas imutáveis. Quando `nodeExecutions[nodeId]` estiver ausente, derivar somente a seleção anterior necessária para o node bloqueado usando a definição de node fixada e `run.runtime`; não preencher nem reescrever seleções de outros nodes. Registrar essa seleção derivada como origem da entrada existente em `executionHistory` antes de aplicar o perfil solicitado ao node bloqueado e aos nodes restantes não concluídos.

[us] Resolve candidate profiles from the current source only after verifying the run's pinned flow, source, and workspace identity. Mark them explicitly as current-source candidates, not as run-pinned choices. Preserve the existing pinned legacy-fallback path. If no profile ID is supplied, prefer a valid pinned fallback; otherwise return `EXECUTION_PROFILE_REQUIRED` with candidate IDs and runtimes when alternatives exist, and use `FALLBACK_NOT_CONFIGURED` only when neither path is available.

[pt] Resolver perfis candidatos da fonte atual somente depois de verificar a identidade fixada de flow, fonte e workspace da run. Identificá-los explicitamente como candidatos da fonte atual, não como opções fixadas na run. Preservar o caminho de fallback legado fixado. Se nenhum ID de perfil for informado, priorizar um fallback legado válido; caso contrário, retornar `EXECUTION_PROFILE_REQUIRED` com IDs e runtimes candidatos quando houver alternativas e usar `FALLBACK_NOT_CONFIGURED` somente quando nenhum dos caminhos estiver disponível.

## Safety and compatibility / Segurança e compatibilidade

[us] Keep the current profile-switch guards for a real rate-limit block, blocked pending node, pinned workspace, factual worktree review, reviewed predecessors, receipt consistency, and retry limit. Runs with existing `nodeExecutions` or `executionProfileSnapshot` continue through their current path. Candidate resolution must not silently change a run or its receipts.

[pt] Manter as proteções atuais da troca de perfil para bloqueio real por rate limit, node pendente bloqueado, workspace fixado, revisão factual do worktree, predecessores revisados, consistência dos receipts e limite de tentativas. Runs com `nodeExecutions` ou `executionProfileSnapshot` existentes continuam pelo caminho atual. Resolver candidatos não pode alterar silenciosamente a run nem seus receipts.

## Evidence path / Caminho de evidência

[us] Service tests establish legacy selection derivation, attempt/history updates, receipt preservation, and all rejection paths. MCP/contract tests establish actionable error and retry-inspection candidate labeling. A regression scenario starts from a legacy run with only `execution.runtime`, blocks its ready node with `RATE_LIMIT`, then resolves and switches to a newly available profile.

[pt] Testes de serviço demonstram a derivação da seleção legada, atualização de tentativa/histórico, preservação de receipts e caminhos de rejeição. Testes de contrato/MCP demonstram o erro acionável e a identificação dos candidatos na inspeção de retry. O cenário de regressão parte de uma run legada com apenas `execution.runtime`, bloqueia seu node pronto com `RATE_LIMIT` e então resolve e troca para um perfil recém-disponível.

# Run execution profiles / Perfis de execução de run

## ADDED Requirements

[pt] Requisitos adicionados

### Requirement: Legacy runs can switch to newly configured execution profiles / Runs legadas podem trocar para perfis de execução recém-configurados

[us] The system SHALL allow a legacy run blocked on a pending node by a rate limit to switch to a valid execution profile currently configured for the same pinned flow source, even when the run has no persisted `nodeExecutions` entry for that node. The service SHALL derive the previous selection from the pinned node definition and `run.runtime`, preserve completed and skipped receipts, increment the blocked node attempt, and record the derived previous selection in execution history. The operation SHALL retain all existing run identity, workspace, worktree, predecessor, receipt, and retry-limit checks.

[pt] O sistema DEVE permitir que uma run legada bloqueada em um node pendente por rate limit troque para um perfil de execução atualmente configurado para a mesma fonte de flow fixada, mesmo quando a run não tiver uma entrada `nodeExecutions` persistida para esse node. O serviço DEVE derivar a seleção anterior a partir da definição de node fixada e de `run.runtime`, preservar receipts concluídos e ignorados, incrementar a tentativa do node bloqueado e registrar a seleção anterior derivada no histórico de execução. A operação DEVE manter todas as verificações existentes de identidade da run, workspace, worktree, predecessores, receipts e limite de tentativas.

#### Scenario: Switch a legacy run after adding an execution profile / Trocar uma run legada após adicionar um perfil de execução

[us] GIVEN a run created with only `execution.runtime` has no `nodeExecutions` entry for its blocked node and is blocked for `RATE_LIMIT` WHEN the operator reviews the pinned workspace and predecessors and selects a valid profile from the same source THEN the service switches the blocked and remaining uncompleted nodes, preserves completed and skipped receipts, increments the blocked attempt, and records the derived previous selection in execution history.

[pt] DADO que uma run criada somente com `execution.runtime` não tem entrada `nodeExecutions` para seu node bloqueado e está bloqueada por `RATE_LIMIT` QUANDO o operador revisa o workspace e os predecessores fixados e seleciona um perfil válido da mesma fonte ENTÃO o serviço troca o perfil dos nodes bloqueado e restantes não concluídos, preserva receipts concluídos e ignorados, incrementa a tentativa do node bloqueado e registra a seleção anterior derivada no histórico de execução.

#### Scenario: Retry inspection identifies current-source candidates / Inspeção de retry identifica candidatos da fonte atual

[us] GIVEN a legacy run has no pinned profile snapshot and its pinned source currently resolves alternate profiles WHEN the caller inspects the blocked node for retry THEN the response identifies the available profiles as current-source candidates and does not present them as pinned run selections.

[pt] DADO que uma run legada não tem snapshot de perfil fixado e sua fonte fixada resolve atualmente perfis alternativos QUANDO o chamador inspeciona o node bloqueado para retry ENTÃO a resposta identifica os perfis disponíveis como candidatos da fonte atual e não os apresenta como seleções fixadas na run.

#### Scenario: Require an explicit profile when current-source alternatives exist / Exigir perfil explícito quando há alternativas na fonte atual

[us] GIVEN a legacy run has no usable pinned fallback and its pinned source has alternate execution profiles WHEN the caller requests a runtime switch without `executionProfileId` THEN the service returns `EXECUTION_PROFILE_REQUIRED` with the available profile IDs and runtimes and does not mutate the run.

[pt] DADO que uma run legada não tem fallback fixado utilizável e sua fonte fixada possui perfis de execução alternativos QUANDO o chamador solicita a troca de runtime sem `executionProfileId` ENTÃO o serviço retorna `EXECUTION_PROFILE_REQUIRED` com os IDs e runtimes disponíveis e não altera a run.

#### Scenario: Report no fallback only when no recovery alternative exists / Informar ausência de fallback somente quando não há alternativa de recuperação

[us] GIVEN a legacy run has neither a usable pinned fallback nor an alternate execution profile WHEN the caller requests a runtime switch without `executionProfileId` THEN the service returns `FALLBACK_NOT_CONFIGURED` and leaves the run unchanged.

[pt] DADO que uma run legada não tem fallback fixado utilizável nem perfil de execução alternativo QUANDO o chamador solicita a troca de runtime sem `executionProfileId` ENTÃO o serviço retorna `FALLBACK_NOT_CONFIGURED` e mantém a run inalterada.

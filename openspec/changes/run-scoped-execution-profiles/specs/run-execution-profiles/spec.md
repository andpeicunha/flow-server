# Run execution profiles / Perfis de execução de run

## Requirements / Requisitos

### Requirement: Runs select and pin an execution profile / Runs selecionam e fixam um perfil de execução

[us] The system SHALL allow each run to select a locally configured execution profile independently of the source profile. The run SHALL persist the selected profile ID and resolved runtime/model/effort settings as an execution snapshot. Changes to local profile configuration SHALL NOT alter an existing run's snapshot.

[pt] O sistema DEVE permitir que cada run selecione um perfil de execução configurado localmente, independentemente do profile da fonte. A run DEVE persistir o ID do perfil selecionado e as configurações resolvidas de runtime/modelo/esforço como snapshot de execução. Mudanças na configuração local do perfil NÃO DEVEM alterar o snapshot de uma run existente.

#### Scenario: Concurrent runs choose different runtimes / Runs simultâneas escolhem runtimes diferentes

[us] GIVEN two runs use the same source profile and flow WHEN each run selects a different valid execution profile THEN both runs can progress concurrently and each node plan and checkpoint is validated against that run's own selected runtime and model.

[pt] DADO que duas runs usam o mesmo profile de fonte e flow QUANDO cada run seleciona um perfil de execução válido diferente ENTÃO ambas podem progredir em paralelo e o plano de cada node e checkpoint é validado contra o runtime e modelo selecionados naquela run.

#### Scenario: Existing run is isolated from profile edits / Run existente fica isolada de alterações no perfil

[us] GIVEN a run has pinned an execution profile WHEN the local profile definition changes THEN the run continues to use its pinned snapshot unless an explicit reviewed profile switch is recorded.

[pt] DADO que uma run fixou um perfil de execução QUANDO a definição local do perfil mudar ENTÃO a run continua usando seu snapshot fixado, a menos que uma troca explícita e revisada de perfil seja registrada.

### Requirement: A reviewed profile switch updates the remaining run / Troca revisada atualiza o restante da run

[us] The system SHALL allow an operator to switch the execution profile of the same run when it is blocked on a pending node due to a rate limit. The operation SHALL require the pinned workspace, a factual worktree review, and confirmation that predecessors were reviewed. It SHALL apply the new profile to the blocked node and all future nodes without completed receipts, preserve completed/skipped receipts, increment the affected node attempt, and record the switch in execution history.

[pt] O sistema DEVE permitir que o operador troque o perfil de execução da mesma run quando ela estiver bloqueada por rate limit em um node pendente. A operação DEVE exigir o workspace fixado, uma revisão factual do worktree e a confirmação de que os predecessores foram revisados. DEVE aplicar o novo perfil ao node bloqueado e a todos os nodes futuros sem receipts concluídos, preservar receipts concluídos/ignorados, incrementar a tentativa do node afetado e registrar a troca no histórico de execução.

#### Scenario: Continue a Claude run from Codex after rate limit / Continuar uma run Claude pelo Codex após rate limit

[us] GIVEN a run created with a Claude execution profile is blocked by a rate limit and a valid Codex execution profile is configured WHEN the operator reviews the worktree and switches the run to the Codex profile THEN the blocked node and every remaining uncompleted node are planned for Codex, prior receipts remain unchanged, and the same run ID is retained.

[pt] DADO que uma run criada com perfil de execução Claude está bloqueada por rate limit e há um perfil de execução Codex válido configurado QUANDO o operador revisa o worktree e troca a run para o perfil Codex ENTÃO o node bloqueado e todos os nodes restantes não concluídos são planejados para Codex, os receipts anteriores permanecem inalterados e o mesmo ID de run é mantido.

#### Scenario: Reject switch without a safe rate-limit block / Rejeitar troca sem bloqueio seguro por rate limit

[us] GIVEN a run is not blocked on a pending node due to a rate limit, its workspace does not match, predecessors were not reviewed, or the new profile is invalid WHEN an operator requests a profile switch THEN the system rejects the operation without changing the run or its execution history.

[pt] DADO que uma run não está bloqueada por rate limit em um node pendente, o workspace não corresponde, os predecessores não foram revisados ou o novo perfil é inválido QUANDO o operador solicita a troca de perfil ENTÃO o sistema rejeita a operação sem alterar a run nem seu histórico de execução.

### Requirement: Execution profile does not change provider credentials / Perfil de execução não troca credenciais do provedor

[us] The system SHALL expose the selected runtime and model to the active harness but SHALL NOT claim to select or switch provider account credentials. Agent guidance SHALL require the active harness to be authenticated for the intended account before executing a node.

[pt] O sistema DEVE expor o runtime e o modelo selecionados ao harness ativo, mas NÃO DEVE afirmar que seleciona ou troca credenciais de conta do provedor. As orientações dos agentes DEVEM exigir que o harness ativo esteja autenticado na conta pretendida antes de executar um node.

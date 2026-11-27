# Run-scoped execution profiles / Perfis de execução por run

## Why / Por quê

[us] Flow sources currently pin one runtime for every run. A run started with Claude cannot be resumed from Codex after a rate limit unless a fallback was configured in advance, and that fallback changes only the blocked node. Separate runs also cannot choose different runtimes while sharing the same source profile. Execution choices belong to each run so parallel runs can use different runtimes and a blocked run can continue under a newly selected profile.

[pt] Hoje, a fonte do flow fixa um runtime para todas as runs. Uma run iniciada com Claude não pode ser retomada pelo Codex após um rate limit sem que um fallback tenha sido configurado antes, e esse fallback troca somente o node bloqueado. Runs distintas também não conseguem escolher runtimes diferentes quando usam o mesmo profile de fonte. As escolhas de execução devem pertencer a cada run, permitindo runtimes diferentes em paralelo e a retomada de uma run bloqueada com outro perfil.

## What changes / O que muda

[us] Add reusable, locally configured execution profiles that define a runtime and model mappings. Select one when creating a run and pin its resolved settings to that run. Permit a reviewed execution-profile switch on a rate-limited run; apply the new profile to the blocked node and all later, not-yet-completed nodes. Keep completed receipts, record the switch in run history, and keep runs isolated so concurrent runs can use different execution profiles. Preserve a compatibility path for existing source-level execution settings during migration.

[pt] Adicionar perfis de execução reutilizáveis, configurados localmente, que definam um runtime e mapeamentos de modelos. Selecionar um perfil ao criar a run e fixar nela as configurações resolvidas. Permitir a troca revisada do perfil de execução de uma run bloqueada por rate limit; aplicar o novo perfil ao node bloqueado e a todos os nodes seguintes ainda não concluídos. Preservar receipts concluídos, registrar a troca no histórico e manter as runs isoladas para que runs simultâneas usem perfis diferentes. Manter compatibilidade com as configurações de execução atuais na fonte durante a migração.

## Non-goals / Fora de escopo

[us] Selecting or switching a provider account inside Codex or Claude authentication; per-node profile selection; automatic retry or runtime switching without an explicit reviewed action; launching agent processes from flow-server.

[pt] Selecionar ou trocar uma conta de provedor dentro da autenticação do Codex ou Claude; escolher perfis por node; repetir ou trocar o runtime automaticamente sem uma ação explícita e revisada; iniciar processos de agente pelo flow-server.

## Expected outcome / Resultado esperado

[us] Two runs from the same flow source can run concurrently under different runtimes. When one run hits a rate limit, its operator can review the pinned worktree and switch the run's execution profile so the blocked node and remaining work continue under the new runtime, without creating a replacement run.

[pt] Duas runs da mesma fonte de flow podem executar em paralelo com runtimes diferentes. Quando uma run atingir rate limit, seu operador poderá revisar o worktree fixado e trocar o perfil de execução da run para que o node bloqueado e o trabalho restante continuem no novo runtime, sem criar outra run.

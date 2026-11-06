# Legacy run profile switching / Troca de perfil em runs legadas

## Why / Por quê

[us] A run created from a source that has only `execution.runtime` may not persist a per-node execution selection. If that run is later blocked by a rate limit and alternate profiles are added to the source, switching the run fails because the service cannot find the previous node selection. Retry inspection also cannot guide the caller to the newly available profiles.

[pt] Uma run criada a partir de uma fonte que contém somente `execution.runtime` pode não persistir uma seleção de execução por node. Se essa run for bloqueada depois por rate limit e novos perfis forem adicionados à fonte, a troca falha porque o serviço não encontra a seleção anterior do node. A inspeção de retry também não orienta o chamador sobre os novos perfis disponíveis.

## What changes / O que muda

[us] Derive the missing previous selection for a blocked legacy node from the run's pinned flow definition and runtime. Allow a reviewed switch to a currently configured execution profile while preserving completed receipts and recording the derived selection in execution history. Make retry inspection expose current-source profile candidates for legacy runs, and return an actionable `EXECUTION_PROFILE_REQUIRED` error when profile candidates exist but no profile ID was supplied.

[pt] Derivar a seleção anterior ausente do node bloqueado de uma run legada a partir da definição de flow fixada e do runtime da run. Permitir uma troca revisada para um perfil de execução configurado atualmente, preservando receipts concluídos e registrando a seleção derivada no histórico de execução. Fazer a inspeção de retry expor candidatos de perfil da fonte atual para runs legadas e retornar o erro acionável `EXECUTION_PROFILE_REQUIRED` quando houver candidatos, mas nenhum ID de perfil for informado.

## Non-goals / Fora de escopo

[us] Automatically switch runtimes, change provider credentials, alter completed receipts, or change the profile snapshots of runs that already have pinned execution profiles.

[pt] Trocar runtimes automaticamente, alterar credenciais de provedor, modificar receipts concluídos ou mudar snapshots de runs que já tenham perfis de execução fixados.

## Expected outcome / Resultado esperado

[us] A legacy run blocked by `RATE_LIMIT` can continue under a newly configured profile after the existing workspace, worktree, predecessor, receipt, flow/source identity, and retry-limit checks pass. Callers can discover the valid next action from retry inspection or the switch error.

[pt] Uma run legada bloqueada por `RATE_LIMIT` pode continuar com um perfil recém-configurado depois que passarem as verificações existentes de workspace, worktree, predecessores, receipts, identidade de flow/fonte e limite de tentativas. O chamador consegue descobrir a próxima ação válida pela inspeção de retry ou pelo erro da troca.

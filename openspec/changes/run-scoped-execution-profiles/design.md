# Design: run-scoped execution profiles / Design: perfis de execução por run

## Ownership and configuration / Responsabilidade e configuração

[us] Keep source profiles responsible for flow discovery, workspace roots, sync, and tool policy. Add reusable execution-profile definitions to the local source configuration, scoped to a source profile. Each definition has a stable ID, display name, runtime, model mappings, and effort mappings where needed. A run selects an execution-profile ID at creation; the service resolves and pins the profile snapshot and effective flow definition. Existing `execution.runtime`, `execution.models`, `execution.efforts`, and `execution.fallback` settings need a documented compatibility/migration rule.

[pt] Manter os profiles de fonte responsáveis por descobrir flows, raízes de workspace, sincronização e política de ferramentas. Adicionar definições reutilizáveis de perfil de execução à configuração local da fonte, vinculadas a um profile de fonte. Cada definição tem ID estável, nome de exibição, runtime, mapeamentos de modelos e, quando necessário, de esforço. A run escolhe um ID de perfil de execução ao ser criada; o serviço resolve e fixa nela um snapshot do perfil e a definição efetiva do flow. As configurações atuais `execution.runtime`, `execution.models`, `execution.efforts` e `execution.fallback` precisam de uma regra documentada de compatibilidade/migração.

## Run lifecycle / Ciclo de vida da run

[us] A run's pinned execution profile is independent of other runs and is immutable except through an explicit switch operation. Switching is allowed only when a run is blocked on a rate-limited pending node, after validating the run ID, pinned workspace, predecessor receipts, and actual worktree review. The new profile applies to the blocked node and every future node without a completed receipt. Completed and skipped nodes keep their receipts and execution metadata. Record the old and new profile snapshots, reason, reviewed predecessors, worktree review, timestamp, and attempt in the run's execution history.

[pt] O perfil de execução fixado em uma run é independente das demais e só pode mudar por uma operação explícita. A troca é permitida quando a run está bloqueada em um node pendente por rate limit, após validar o ID da run, o workspace fixado, os receipts predecessores e a revisão real do worktree. O novo perfil vale para o node bloqueado e todos os nodes futuros sem receipt concluído. Nodes concluídos ou ignorados mantêm seus receipts e metadados de execução. Registrar no histórico da run os snapshots antigo e novo, motivo, predecessores revisados, revisão do worktree, horário e tentativa.

## Runtime dispatch and concurrency / Encaminhamento de runtime e concorrência

[us] `flow_next` must return the execution selected for that run, not infer it from the caller's current harness or a source-wide runtime. A Codex session may inspect and continue a run whose original runtime was Claude after the reviewed switch; checkpoints must match the selected runtime, model, and attempt. Mutations remain serialized per run ID, while separate runs proceed independently. Service-wide locks protect service ownership only and must not pin a runtime for all runs.

[pt] `flow_next` deve retornar a execução escolhida para aquela run, sem inferi-la do harness atual de quem chamou nem de um runtime global da fonte. Uma sessão Codex pode inspecionar e continuar uma run originalmente iniciada com Claude após a troca revisada; os checkpoints devem corresponder ao runtime, modelo e tentativa selecionados. Mutations continuam serializadas por ID de run, enquanto runs distintas progridem independentemente. Locks globais protegem apenas a posse do serviço e não devem fixar um runtime para todas as runs.

## Account boundary / Limite das contas

[us] An execution profile selects runtime and model identifiers; it does not select or change provider credentials. Since flow-server guides an agent rather than launching it, the active Codex or Claude harness must already have access to the intended account. The contract and UI must state this boundary clearly.

[pt] Um perfil de execução escolhe runtime e identificadores de modelo; ele não seleciona nem troca credenciais de provedor. Como o flow-server orienta um agente em vez de iniciá-lo, o harness Codex ou Claude ativo já precisa ter acesso à conta pretendida. O contrato e a interface devem deixar esse limite claro.

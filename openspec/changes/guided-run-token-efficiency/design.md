# Design: guided run token efficiency / Design: eficiência de tokens em runs guiadas

## Report lifecycle / Ciclo de vida dos relatórios

- [us] Keep reports below the run dossier, at `runs/<runId>/reports/<nodeId>.json`. Add a narrow `flow_report_write` MCP tool taking `runId`, `nodeId`, and JSON report content. Resolve the run and pending node, serialize bounded JSON, and write atomically beneath the canonical report directory. Reject traversal, symlinks, oversized payloads, completed/skipped nodes, and writes to another run.
- [pt] Manter relatórios dentro do dossiê da run, em `runs/<runId>/reports/<nodeId>.json`. Adicionar a ferramenta MCP restrita `flow_report_write`, com `runId`, `nodeId` e conteúdo JSON. Resolver a run e o nó pendente, serializar JSON limitado e gravar atomicamente sob o diretório canônico de relatórios. Rejeitar traversal, symlinks, payloads grandes, nós concluídos/pulados e gravação em outra run.
- [us] A receipt may include `reportPath` and `reportSha256` together. Checkpoint resolves only a path under the current run, requires the file to exist, recomputes SHA-256, rejects a mismatch, and stores the normalized relative path and verified digest. Inline output remains supported. Audit reports missing or changed files as integrity findings.
- [pt] Um receipt pode incluir `reportPath` e `reportSha256` juntos. O checkpoint aceita somente caminhos dentro da run atual, exige que o arquivo exista, recalcula SHA-256, rejeita divergência e armazena caminho relativo normalizado e digest validado. Output inline continua aceito. A auditoria aponta arquivos ausentes ou alterados.
- [us] Later prompts include short summaries and report paths, never report bodies by default. Include the canonical report directory and the report protocol in every node prompt. The orchestrator may open a report only when needed to decide a gate.
- [pt] Prompts seguintes incluem resumos curtos e caminhos, nunca o conteúdo dos relatórios por padrão. Incluir o diretório canônico e o protocolo em todos os prompts de nó. O orquestrador pode abrir um relatório quando precisar decidir um gate.

## Explicit reuse / Reutilização explícita

- [us] `flow_start_guided` may accept `reuseFromRunId`. At creation, compare the pinned flow identity and a deterministic context fingerprint covering workspace identity, source/head revision when available, flow content hash, task, and relevant specification fingerprint. Only completed, eligible analysis nodes may be reused. Copy receipts into the new run as immutable receipts with `reusedFrom: {runId,nodeId,contextHash}` and preserve source report references only when content is copied into the new run and its hash is verified. Reject missing fingerprints or mismatches; never infer reuse.
- [pt] `flow_start_guided` pode aceitar `reuseFromRunId`. Na criação, comparar a identidade do flow e uma impressão digital determinística do contexto, cobrindo identidade do workspace, revisão/head quando disponível, hash do flow, tarefa e hash relevante da especificação. Só nós de análise concluídos e elegíveis podem ser reutilizados. Copiar receipts para a nova run como receipts imutáveis com `reusedFrom: {runId,nodeId,contextHash}` e preservar referências de relatório somente se o conteúdo for copiado para a nova run e o hash for validado. Rejeitar fingerprints ausentes ou divergentes; nunca inferir reutilização.
- [us] A reused receipt is visible in `flow_next` and audit. It cannot satisfy a node whose inputs or dependencies differ. Implementation must define explicit node eligibility and dependency/context fingerprints; any ambiguity fails closed.
- [pt] Um receipt reutilizado aparece em `flow_next` e na auditoria. Ele não pode satisfazer nó cujas entradas ou dependências sejam diferentes. A implementação deve definir elegibilidade de nós e fingerprints de dependências/contexto; qualquer dúvida bloqueia a reutilização.

## Output schemas and executor capabilities / Schemas de saída e capacidades do executor

- [us] Nodes may declare an optional JSON Schema for `receipt.output`. Validate it at checkpoint with the existing schema tooling. Invalid outputs are rejected with a bounded error naming the node and schema path. No schema means current permissive behavior.
- [pt] Nós podem declarar JSON Schema opcional para `receipt.output`. Validar no checkpoint com a ferramenta de schema já existente. Outputs inválidos são rejeitados com erro limitado que identifica nó e caminho do schema. Sem schema, mantém-se o comportamento permissivo atual.
- [us] Flow resolution compares declared Skills to the selected executor's known Skill capability/catalog. Return structured warnings in `flow_next` when unsupported or unverified, and persist observed capability warnings in the run audit. Warnings do not silently claim a Skill was loaded and do not change node scheduling.
- [pt] A resolução do flow compara Skills declaradas com a capacidade/catálogo conhecido do executor selecionado. Retorna avisos estruturados em `flow_next` quando não houver suporte ou confirmação e persiste esses avisos na auditoria da run. Avisos não afirmam que uma Skill foi carregada e não alteram o agendamento do nó.

## Parallel work / Trabalho paralelo

- [us] `flow_next` already returns all ready independent nodes. Document that they may execute concurrently, that each must produce its own receipt/report, and that the run should checkpoint each result independently before requesting the next scheduling decision. Dependency and stop rules remain authoritative.
- [pt] `flow_next` já retorna todos os nós independentes disponíveis. Documentar que podem executar em paralelo, que cada um deve produzir seu próprio receipt/relatório e que cada resultado deve ser registrado separadamente antes da próxima decisão de agendamento. Dependências e regras de parada continuam prevalecendo.

## Verification and compatibility / Verificação e compatibilidade

- [us] Add contract/service/MCP/audit coverage for safe report paths, atomic write, hash mismatch, legacy inline outputs, reuse rejection and acceptance, schema validation, capability warnings, and parallel prompt instructions. Measure orchestrator input/output token counts on a representative multi-node run before and after.
- [pt] Adicionar cobertura de contrato/serviço/MCP/auditoria para caminhos seguros, gravação atômica, hash divergente, outputs inline antigos, rejeição e aceitação de reutilização, validação de schema, avisos de capacidade e instruções de paralelismo. Medir tokens de entrada/saída do orquestrador em uma run representativa antes e depois.

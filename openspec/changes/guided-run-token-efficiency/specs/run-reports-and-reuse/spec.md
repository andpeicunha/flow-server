## ADDED Requirements

### Requirement: Node reports are stored by run reference / Relatórios de nó são armazenados por referência da run

**[us]** A guided run SHALL allow a ready node to write one bounded JSON report using `flow_report_write`. The tool SHALL write atomically under that run's report directory, reject traversal and symlinks, and reject writes for another run or a node that is not ready. It SHALL return a run-relative `reportPath` and the SHA-256 digest of the exact stored bytes.

**[pt]** Uma run guiada SHALL permitir que um nó disponível grave um relatório JSON limitado usando `flow_report_write`. A ferramenta SHALL gravar atomicamente no diretório de relatórios da run, rejeitar traversal e symlinks e rejeitar gravações em outra run ou em nó que não esteja disponível. Ela SHALL retornar `reportPath` relativo à run e o SHA-256 dos bytes armazenados.

#### Scenario: Agent writes a report / Agente grava um relatório

**[us]**

- **WHEN** a ready node writes a valid report
- **THEN** flow-server stores it inside that run and returns its relative path and digest

**[pt]**

- **WHEN** um nó disponível grava um relatório válido
- **THEN** flow-server o armazena dentro daquela run e retorna caminho relativo e digest

#### Scenario: Agent tries to escape the report directory / Agente tenta sair do diretório de relatórios

**[us]**

- **WHEN** a request contains a traversal path, symlink target, oversized report, or different run identifier
- **THEN** the request is rejected without writing outside the target run

**[pt]**

- **WHEN** a requisição contém traversal, destino symlink, relatório grande demais ou identificador de outra run
- **THEN** a requisição é rejeitada sem gravar fora da run selecionada

### Requirement: Checkpoint validates report references / Checkpoint valida referências de relatório

**[us]** A receipt MAY include both `output.reportPath` and `output.reportSha256`. When either is present, both SHALL be present, `output.summary` SHALL be short text, the path SHALL resolve only to the current run's report directory, the file SHALL exist, and its content digest SHALL match. The server SHALL persist the verified relative path and digest. Receipts without report references SHALL retain inline behavior.

**[pt]** Um receipt MAY incluir `output.reportPath` e `output.reportSha256`. Quando um deles estiver presente, ambos SHALL estar presentes, `output.summary` SHALL ser texto curto, o caminho SHALL apontar somente para o diretório de relatórios da run atual, o arquivo SHALL existir e seu digest SHALL corresponder. O servidor SHALL persistir caminho relativo e digest verificados. Receipts sem referência SHALL manter o comportamento inline.

#### Scenario: Report digest changed before checkpoint / Digest do relatório mudou antes do checkpoint

**[us]**

- **WHEN** checkpoint receives a report reference whose file is missing, outside the run, or has a different digest
- **THEN** the receipt is rejected and the node remains pending

**[pt]**

- **WHEN** checkpoint recebe referência cujo arquivo não existe, está fora da run ou tem digest diferente
- **THEN** o receipt é rejeitado e o nó continua pendente

### Requirement: Future prompts use report references / Prompts seguintes usam referências

**[us]** When a completed receipt has a verified report reference, `flow_next` SHALL provide only its bounded summary and reference metadata by default. Gate fields required by conditions SHALL remain available. The full report SHALL be opened only when an agent explicitly decides the summary is insufficient.

**[pt]** Quando um receipt concluído tem referência de relatório verificada, `flow_next` SHALL fornecer somente resumo limitado e metadados de referência por padrão. Campos usados por condições de gate SHALL continuar disponíveis. O relatório completo SHALL ser aberto somente quando o agente decidir explicitamente que o resumo é insuficiente.

#### Scenario: Later prompt uses the report summary / Prompt seguinte usa o resumo do relatório

- **WHEN** a later node needs context from a completed report-backed node
- **THEN** its prompt includes the bounded summary and reference but omits the full report body

- **WHEN** um nó seguinte precisa do contexto de um nó concluído com relatório
- **THEN** o prompt inclui resumo limitado e referência, sem incluir o relatório completo

### Requirement: Report integrity appears in audit / Integridade de relatório aparece na auditoria

**[us]** `flow_audit` SHALL verify each referenced report's existence and digest and return bounded integrity findings without returning report bodies.

**[pt]** `flow_audit` SHALL verificar existência e digest de cada relatório referenciado e retornar achados de integridade limitados, sem retornar o conteúdo dos relatórios.

#### Scenario: Referenced report was modified / Relatório referenciado foi alterado

- **WHEN** the report bytes no longer match the receipt digest
- **THEN** the audit returns a bounded integrity finding without returning report contents

- **WHEN** os bytes do relatório não correspondem mais ao digest do receipt
- **THEN** a auditoria retorna um achado de integridade limitado sem expor o conteúdo

### Requirement: Receipt reuse is explicit and context-bound / Reutilização de receipts é explícita e vinculada ao contexto

**[us]** `flow_start_guided` MAY accept `reuseFromRunId` and an explicit bounded `reuseNodeIds` list. Reuse SHALL require completed source receipts, matching flow/profile/execution profile, task, canonical workspace, source revision, and OpenSpec fingerprint. The server SHALL compute and pin context fingerprints at run creation, reject dirty or unreadable contexts when identity cannot be established, copy any referenced report into the new run, and stamp immutable `reusedFrom` provenance containing source run, source node, and context hash. No receipt SHALL be reused implicitly.

**[pt]** `flow_start_guided` MAY aceitar `reuseFromRunId` e uma lista explícita e limitada `reuseNodeIds`. A reutilização SHALL exigir receipts concluídos e correspondência de flow/perfil/perfil de execução, tarefa, workspace canônico, revisão de código e fingerprint do OpenSpec. O servidor SHALL calcular e fixar fingerprints na criação da run, rejeitar contexto sujo ou ilegível quando não puder estabelecer a identidade, copiar relatório referenciado para a nova run e registrar proveniência imutável `reusedFrom` com run de origem, nó de origem e hash do contexto. Nenhum receipt SHALL ser reutilizado implicitamente.

#### Scenario: Source context changed / Contexto de origem mudou

**[us]**

- **WHEN** source and destination differ in code, OpenSpec, flow, task, profile, or workspace identity
- **THEN** reuse is rejected before any receipt is copied

**[pt]**

- **WHEN** origem e destino diferem em código, OpenSpec, flow, tarefa, perfil ou identidade do workspace
- **THEN** a reutilização é rejeitada antes de copiar qualquer receipt

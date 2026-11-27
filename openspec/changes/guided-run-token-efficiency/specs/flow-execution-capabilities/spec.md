## ADDED Requirements

### Requirement: Node output schemas are optional / Schemas de saída de nó são opcionais

**[us]** A flow node MAY declare `outputSchema` as a bounded, local JSON Schema. The flow document SHALL validate the schema definition. At checkpoint, when the node declares a schema, the server SHALL reject an output that does not conform. A node without `outputSchema` SHALL retain current behavior.

**[pt]** Um nó MAY declarar `outputSchema` como JSON Schema local e limitado. O documento do flow SHALL validar a definição do schema. No checkpoint, quando o nó declarar schema, o servidor SHALL rejeitar output incompatível. Nó sem `outputSchema` SHALL manter o comportamento atual.

#### Scenario: Node output matches its schema / Output do nó corresponde ao schema

- **WHEN** a completed node checkpoints a valid JSON output matching its declared schema
- **THEN** the checkpoint is accepted, while a nonconforming output is rejected

- **WHEN** um nó concluído registra output JSON compatível com o schema declarado
- **THEN** o checkpoint é aceito, e um output incompatível é rejeitado

### Requirement: Executor Skill capability is reported / Capacidade de Skills do executor é informada

**[us]** `flow_next` SHALL return a structured warning when a node declares Skills that the configured executor is known not to support or when capability is unknown. It SHALL distinguish unavailable from unverified capability and SHALL NOT claim a Skill was loaded unless the executor reported that fact.

**[pt]** `flow_next` SHALL retornar aviso estruturado quando um nó declarar Skills que o executor configurado não suporta ou quando a capacidade for desconhecida. SHALL distinguir capacidade indisponível de não verificada e SHALL NOT afirmar que uma Skill foi carregada sem confirmação do executor.

#### Scenario: Executor Skill support is unverified / Suporte do executor à Skill não foi verificado

- **WHEN** a node declares Skills and the executor's Skill capability is unknown
- **THEN** `flow_next` returns an unverified-capability warning without claiming the Skills were loaded

- **WHEN** um nó declara Skills e a capacidade do executor é desconhecida
- **THEN** `flow_next` retorna aviso de capacidade não verificada sem afirmar que as Skills foram carregadas

### Requirement: Independent ready nodes may run in parallel / Nós independentes podem rodar em paralelo

**[us]** Documentation SHALL state that all independent nodes returned by one `flow_next` response may run in parallel. Each node SHALL write its own report and checkpoint independently. Dependencies, conditions, stop rules, and per-node execution profiles remain authoritative.

**[pt]** A documentação SHALL informar que nós independentes retornados na mesma resposta `flow_next` podem rodar em paralelo. Cada nó SHALL gravar seu próprio relatório e checkpoint de forma independente. Dependências, condições, regras de parada e perfis de execução por nó continuam prevalecendo.

#### Scenario: Scheduler returns independent ready nodes / Agendador retorna nós independentes disponíveis

- **WHEN** multiple nodes are ready and have no dependency on one another
- **THEN** the response may include all of them for parallel execution, with a separate report and checkpoint for each

- **WHEN** vários nós estão disponíveis e não dependem uns dos outros
- **THEN** a resposta pode incluí-los para execução paralela, cada um com relatório e checkpoint próprios

### Requirement: Token savings are measured / Economia de tokens é medida

**[us]** A before/after comparison SHALL report orchestrator input and output tokens per node and total run tokens for a comparable multi-node run. The report SHALL identify differences in flow content and runtime and SHALL not claim a measured reduction when usage evidence is missing.

**[pt]** Uma comparação antes/depois SHALL informar tokens de entrada e saída do orquestrador por nó e total da run comparável. O relatório SHALL identificar diferenças no conteúdo do flow e no runtime e SHALL não afirmar redução medida sem evidência de uso.

#### Scenario: Comparable token evidence is unavailable / Evidência comparável de tokens indisponível

- **WHEN** a review has no comparable before-and-after runtime usage records
- **THEN** it reports the missing evidence and does not claim measured token savings

- **WHEN** a revisão não tem registros comparáveis de uso antes e depois
- **THEN** informa a ausência de evidência e não afirma economia medida de tokens

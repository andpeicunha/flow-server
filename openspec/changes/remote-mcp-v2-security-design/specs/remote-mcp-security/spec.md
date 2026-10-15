## ADDED Requirements

### Requirement: Remote catalog returns approved flow metadata only / Catálogo remoto retorna apenas metadados de flow aprovados

**[us]** The remote catalog SHALL return only metadata for approved flow
releases. `flow_recommend` SHALL NOT return a path, URL, token, repository,
workspace, receipt, or unapproved flow definition.

**[pt]** O catálogo remoto SHALL retornar apenas metadados de releases de flow
aprovadas. `flow_recommend` SHALL NOT retornar path, URL, token, repositório,
workspace, receipt ou definição de flow não aprovada.

#### Scenario: Task does not match an approved flow / Tarefa não corresponde a flow aprovado

**[us]**

- **WHEN** no approved flow matches the task summary
- **THEN** `flow_recommend` returns an empty list and does not create a run

**[pt]**

- **WHEN** nenhum flow aprovado corresponde ao resumo da tarefa
- **THEN** `flow_recommend` retorna lista vazia e não cria uma run

### Requirement: Remote MCP uses a configured bearer token / MCP remoto usa bearer token configurado

**[us]** The remote MCP SHALL require the configured bearer token for every
catalog request. It SHALL reject a missing or invalid token without exposing
catalog data. The implementation SHALL never log a bearer token.

**[pt]** O MCP remoto SHALL exigir o bearer token configurado para cada
requisição do catálogo. Ele SHALL rejeitar token ausente ou inválido sem expor
dados do catálogo. A implementação nunca deve registrar um bearer token.

#### Scenario: Client has no valid token / Cliente não tem token válido

**[us]**

- **WHEN** a client calls a remote catalog tool without the configured token
- **THEN** the MCP rejects the request with a safe authentication error

**[pt]**

- **WHEN** um cliente chama uma tool do catálogo remoto sem o token configurado
- **THEN** o MCP rejeita a requisição com erro de autenticação seguro

### Requirement: Definition delivery is versioned and verifiable / Entrega de definição é versionada e verificável

**[us]** `flow_get_definition` SHALL require an approved `flowId` and exact
version. It SHALL return the immutable definition, schema version, content hash,
and release metadata. The local runner SHALL verify these values before use.

**[pt]** `flow_get_definition` SHALL exigir `flowId` aprovado e versão exata.
Ela SHALL retornar definição imutável, versão do schema, hash do conteúdo e
metadados da release. O runner local SHALL verificar esses valores antes do uso.

#### Scenario: Content hash does not match / Hash de conteúdo não corresponde

**[us]**

- **WHEN** the received definition hash differs from the declared content hash
- **THEN** the local runner rejects the definition and does not execute it

**[pt]**

- **WHEN** o hash da definição recebida difere do hash de conteúdo declarado
- **THEN** o runner local rejeita a definição e não a executa

### Requirement: Remote catalog has no execution or workspace access / Catálogo remoto não tem execução nem acesso ao workspace

**[us]** The remote catalog SHALL NOT expose tools for shell execution, agent
execution, repository access, workspace access, generic downloads, arbitrary
URL fetches, or writes. The local runner remains the execution boundary.

**[pt]** O catálogo remoto SHALL NOT expor tools para execução shell, execução
de agente, acesso a repositório, acesso a workspace, downloads genéricos, busca
de URL arbitrária ou escrita. O runner local continua sendo o limite de execução.

#### Scenario: Client requests an unsupported remote action / Cliente pede ação remota não suportada

**[us]**

- **WHEN** a client requests a remote write or execution action
- **THEN** the catalog rejects the request without accessing local or repository data

**[pt]**

- **WHEN** um cliente pede ação de escrita ou execução remota
- **THEN** o catálogo rejeita a requisição sem acessar dados locais ou do repositório

### Requirement: Run evidence is redacted and linked to an approved flow version / Evidência de run é redigida e ligada a uma versão de flow aprovada

**[us]** The catalog SHALL accept run evidence only for an approved flow ID and
version. It SHALL accept only the documented safe event fields and SHALL reject
raw prompts, workspace paths, file bodies, tokens, secrets, and full agent output.

**[pt]** O catálogo SHALL aceitar evidência de run apenas para ID e versão de
flow aprovados. Ele SHALL aceitar apenas campos seguros de evento documentados e
SHALL rejeitar prompts brutos, paths de workspace, corpo de arquivo, tokens,
secrets e saída completa do agente.

#### Scenario: Evidence contains a secret field / Evidência contém campo secreto

**[us]**

- **WHEN** a client sends evidence with a token, secret, raw prompt, or file body
- **THEN** the catalog rejects the evidence and records only a safe error code

**[pt]**

- **WHEN** um cliente envia evidência com token, secret, prompt bruto ou corpo de arquivo
- **THEN** o catálogo rejeita a evidência e registra apenas código de erro seguro

#### Scenario: Valid evidence is accepted / Evidência válida é aceita

**[us]**

- **WHEN** `flow_record_run_evidence` receives an allowed event for an approved
  flow version
- **THEN** the catalog stores only the documented safe fields and returns its
  server-generated evidence ID

**[pt]**

- **WHEN** `flow_record_run_evidence` recebe um evento permitido para versão de
  flow aprovada
- **THEN** o catálogo armazena somente os campos seguros documentados e retorna
  seu ID de evidência gerado pelo servidor

#### Scenario: Evidence fails structural validation / Evidência falha na validação estrutural

**[us]**

- **WHEN** evidence has an unknown field, oversized payload, duplicate event ID,
  invalid identifier, negative counter, or invalid status transition
- **THEN** the catalog rejects it without storing the payload and returns only a
  safe error code

**[pt]**

- **WHEN** uma evidência tem campo desconhecido, payload muito grande, ID de
  evento duplicado, identificador inválido, contador negativo ou transição de
  status inválida
- **THEN** o catálogo a rejeita sem armazenar o payload e retorna somente um
  código de erro seguro

### Requirement: Analysis uses sufficient valid evidence only / Análise usa somente evidência válida suficiente

**[us]** `flow_analyze_flow` SHALL require an approved `flowId` and version and
SHALL use only stored evidence that passed validation for that exact version. It
SHALL reject an unapproved version and SHALL return no finding when the valid
evidence is insufficient to support one.

**[pt]** `flow_analyze_flow` SHALL exigir `flowId` e versão aprovados e SHALL
usar somente evidência armazenada que passou na validação para essa versão
exata. Ela SHALL rejeitar uma versão não aprovada e SHALL não retornar achado
quando a evidência válida for insuficiente para sustentá-lo.

#### Scenario: Analysis lacks sufficient evidence / Análise não tem evidência suficiente

**[us]**

- **WHEN** an agent requests analysis for an approved version with no valid
  evidence or less than the documented minimum
- **THEN** the catalog returns no finding and does not create an improvement proposal

**[pt]**

- **WHEN** um agente pede análise para versão aprovada sem evidência válida ou
  abaixo do mínimo documentado
- **THEN** o catálogo não retorna achado e não cria proposta de melhoria

### Requirement: Improvement proposals require human approval / Propostas de melhoria exigem aprovação humana

**[us]** `flow_analyze_flow` SHALL return evidence-based findings and suggestions.
`flow_record_improvement_proposal` SHALL create only a `pending_review` proposal
with the source flow version and evidence IDs. The catalog SHALL generate the
proposal ID and date. Neither tool SHALL publish a new flow version, replace a
definition, or alter a running flow.

**[pt]** `flow_analyze_flow` SHALL retornar achados e sugestões baseados em
evidência. `flow_record_improvement_proposal` SHALL criar apenas proposta
`pending_review` com versão de flow de origem e IDs de evidência. O catálogo
SHALL gerar o ID e a data da proposta. Nenhuma das tools SHALL publicar nova
versão de flow, substituir definição ou alterar flow em execução.

#### Scenario: Agent suggests a node change / Agente sugere alteração de node

**[us]**

- **WHEN** an agent records an improvement proposal for a completed run
- **THEN** the catalog stores it as `pending_review` and leaves all flow releases unchanged

**[pt]**

- **WHEN** um agente registra proposta de melhoria para uma run concluída
- **THEN** o catálogo a armazena como `pending_review` e mantém todas as releases de flow sem mudança

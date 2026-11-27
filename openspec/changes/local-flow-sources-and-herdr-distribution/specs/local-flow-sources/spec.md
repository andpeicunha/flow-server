## ADDED Requirements

### Requirement: Flow sources are explicit and local / Fontes de flow são explícitas e locais

**[us]** `flow-server` SHALL load personal flows only from configured canonical
local directories. It SHALL NOT search `$HOME`, infer a repository, contact a
remote service, or read outside a configured source root.

**[pt]** O `flow-server` SHALL carregar flows pessoais somente de diretórios
locais canônicos configurados. Ele SHALL NOT procurar no `$HOME`, inferir um
repositório, contatar serviço remoto ou ler fora da raiz configurada.

#### Scenario: No source is configured / Nenhuma fonte está configurada

**[us]**

- **WHEN** `flow-server` starts without a configured personal source
- **THEN** it exposes only bundled starter metadata and does not search the filesystem

**[pt]**

- **WHEN** o `flow-server` inicia sem uma fonte pessoal configurada
- **THEN** ele expõe somente metadados iniciais empacotados e não procura no filesystem

#### Scenario: A flow escapes its source root / Um flow escapa da raiz da fonte

**[us]**

- **WHEN** a configured entry resolves through a symlink outside its source root
- **THEN** `flow-server` rejects the entry and does not read the target

**[pt]**

- **WHEN** uma entrada configurada resolve por symlink para fora da raiz da fonte
- **THEN** o `flow-server` rejeita a entrada e não lê o destino

### Requirement: Local and Git modes share the same execution boundary / Modos local e Git compartilham o mesmo limite de execução

**[us]** A source SHALL use `local` or `git` mode. Both modes SHALL resolve to a
local directory before flow discovery. Git mode SHALL NOT be required for
execution and SHALL NOT grant `flow-server` access to Git credentials.

**[pt]** Uma fonte SHALL usar modo `local` ou `git`. Ambos SHALL resolver para
um diretório local antes da descoberta de flows. O modo Git SHALL NOT ser
necessário para execução e SHALL NOT dar ao `flow-server` acesso a credenciais Git.

#### Scenario: Git provider is unavailable / Provedor Git está indisponível

**[us]**

- **WHEN** a valid Git worktree is present but its remote provider is unavailable
- **THEN** `flow-server` can validate and execute the local flow without network access

**[pt]**

- **WHEN** uma worktree Git válida existe, mas o provedor remoto está indisponível
- **THEN** o `flow-server` valida e executa o flow local sem acesso de rede

### Requirement: YAML is parsed through a restricted profile / YAML passa por perfil restrito

**[us]** The loader SHALL accept YAML authoring without custom tags, executable
types, merge keys, duplicate keys, aliases, or cyclic references. It SHALL
enforce documented size and nesting limits before canonicalization.

**[pt]** O loader SHALL aceitar autoria YAML sem tags customizadas, tipos
executáveis, merge keys, chaves duplicadas, aliases ou referências cíclicas. Ele
SHALL aplicar limites documentados de tamanho e profundidade antes da
canonicalização.

#### Scenario: YAML uses an unsafe feature / YAML usa recurso inseguro

**[us]**

- **WHEN** a flow document contains a custom tag, alias, duplicate key, or exceeds a resource limit
- **THEN** validation fails closed and the flow is not listed or executed

**[pt]**

- **WHEN** um flow contém tag customizada, alias, chave duplicada ou excede um limite
- **THEN** a validação falha fechada e o flow não é listado nem executado

### Requirement: Valid flows have deterministic canonical identity / Flows válidos têm identidade canônica determinística

**[us]** YAML and JSON inputs SHALL pass through the same versioned schema and
canonicalization. Equivalent valid definitions SHALL produce the same canonical
content hash. Unknown fields, invalid dependencies, unsupported runtimes,
models, or effort values SHALL fail closed.

**[pt]** Entradas YAML e JSON SHALL passar pelo mesmo schema versionado e pela
mesma canonicalização. Definições válidas equivalentes SHALL produzir o mesmo
hash canônico. Campos desconhecidos, dependências inválidas, runtimes, modelos ou
valores de effort não suportados SHALL falhar fechados.

#### Scenario: YAML and JSON describe the same flow / YAML e JSON descrevem o mesmo flow

**[us]**

- **WHEN** equivalent YAML and JSON documents pass validation
- **THEN** they produce the same canonical model and content hash

**[pt]**

- **WHEN** documentos YAML e JSON equivalentes passam na validação
- **THEN** eles produzem o mesmo modelo canônico e hash de conteúdo

### Requirement: Active runs keep their selected flow identity / Runs ativas mantêm a identidade do flow selecionado

**[us]** A run SHALL record source ID, canonical content hash, and optional Git
commit when it starts. A source update SHALL NOT change the definition selected
by an active run.

**[pt]** Uma run SHALL registrar ID da fonte, hash canônico e commit Git opcional
ao iniciar. Uma atualização da fonte SHALL NOT mudar a definição selecionada por
uma run ativa.

#### Scenario: Source changes during a run / Fonte muda durante uma run

**[us]**

- **WHEN** a flow file changes after a run has started
- **THEN** the active run continues with its recorded definition and identity

### Requirement: Agent workflow YAML preserves execution controls / YAML preserva controles dos agents

**[us]** The loader SHALL accept the bounded v2 flow contract used by agent
workflows, including agent, role, model, effort or variant, executor, Skills,
constraints, prompt/input/output, dependencies, routing metadata, conditions,
and stop rules. It SHALL normalize the existing `name`, `route`, and singular
`stopWhen` forms. Unknown fields, invalid references, duplicate node IDs, and
dependency cycles SHALL fail validation.

**[pt]** O loader SHALL aceitar o contrato v2 limitado usado pelos workflows de
agentes, incluindo agente, role, modelo, effort ou variant, executor, Skills,
restrições, prompt/input/output, dependências, roteamento, condições e regras
de parada. Ele SHALL normalizar as formas existentes `name`, `route` e
`stopWhen` singular. Campos desconhecidos, referências inválidas, IDs de node
duplicados e ciclos nas dependências SHALL falhar na validação.

#### Scenario: Existing workflow YAML is loaded / YAML existente é carregado

**[us]**

- **WHEN** a configured source contains a valid existing agent workflow YAML
- **THEN** listing and run creation preserve the configured agent, model,
  effort/variant, Skills, prompt, dependencies, conditions, and stop rules

**[pt]**

- **WHEN** uma fonte configurada contém YAML válido no formato atual de workflow
- **THEN** listagem e criação da run preservam agente, modelo, effort/variant,
  Skills, prompt, dependências, condições e regras de parada

### Requirement: Profile resolution asks only on uncertainty / Profile só pergunta quando há dúvida

**[us]** Each local source MAY declare workspace roots. The runner SHALL select a
profile automatically only for a unique most-specific workspace match and a
unique explicit flow or a single routed flow match. Multiple routed candidates SHALL
return `needs_confirmation` and SHALL NOT create a run. Duplicate flow IDs in
different profiles SHALL remain isolated by profile ID.

**[pt]** Cada fonte local MAY declarar raízes de workspace. O runner SHALL
selecionar profile automaticamente somente com correspondência única de
workspace mais específico e flow explícito ou roteado sem empate. Se faltar
correspondência ou houver conflito, SHALL retornar `needs_confirmation` e SHALL
NOT criar run. IDs iguais em profiles diferentes SHALL permanecer isolados pelo
ID do profile.

#### Scenario: Workspace and flow are trusted / Workspace e flow são confiáveis

**[us]**

- **WHEN** one profile uniquely owns the workspace and one explicit flow is
  selected or only one flow matches routing terms
- **THEN** the runner may start the run without an extra confirmation step

**[pt]**

- **WHEN** um profile é o único associado ao workspace e um flow explícito ou
  uma regra de roteamento resolve sem empate
- **THEN** o runner pode iniciar a run sem pedir confirmação extra

#### Scenario: Workspace or flow is uncertain / Workspace ou flow é incerto

**[us]**

- **WHEN** no unique profile or flow can be resolved
- **THEN** the runner returns candidate profiles/flows and does not create a run

**[pt]**

- **WHEN** não é possível resolver um único profile ou flow
- **THEN** o runner retorna profiles/flows candidatos e não cria a run

#### Scenario: Multiple flows match routing terms / Mais de um flow corresponde ao roteamento

**[us]**

- **WHEN** routing terms match more than one flow, regardless of priority
- **THEN** the runner returns `needs_confirmation` with candidate flows and does
  not create a run

**[pt]**

- **WHEN** os termos de roteamento correspondem a mais de um flow, mesmo com
  prioridades diferentes
- **THEN** o runner retorna `needs_confirmation` com os flows candidatos e não
  cria uma run

### Requirement: The scheduler honors node controls / O scheduler respeita controles dos nodes

**[us]** `flow_next` SHALL return only nodes whose dependencies and conditions
are satisfied, with the configured agent, model, effort/variant, executor,
Skills, constraints, and rendered prompt. It SHALL record false conditional
nodes as skipped. Missing condition output SHALL block scheduling. Stop rules
SHALL return a stopped decision before any dependent node is offered. Skipped
conditional branches SHALL satisfy dependency joins. Prompt rendering SHALL
preserve `{{task}}`, `{{context}}` (completed node outputs), `{{lastAnswer}}`,
and `{{step.<id>}}` behavior.

**[pt]** `flow_next` SHALL retornar somente nodes com dependências e condições
satisfeitas, incluindo agente, modelo, effort/variant, executor, Skills,
restrições e prompt configurados. Nodes com condição falsa SHALL ser registrados
como ignorados. Saída ausente para uma condição SHALL bloquear o scheduler.
Regras de parada SHALL retornar decisão de parada antes de oferecer nodes
dependentes. Branches condicionais ignorados SHALL satisfazer joins de
dependências. A renderização deve preservar `{{task}}`, `{{context}}` (saídas
concluídas), `{{lastAnswer}}` e `{{step.<id>}}`.

#### Scenario: A node waits for its configured condition / Node aguarda a condição configurada

**[us]**

- **WHEN** a node condition references a prior node output that is not present
- **THEN** `flow_next` returns a blocked decision and the service rejects a
  checkpoint that attempts to bypass the condition

**[pt]**

- **WHEN** a condição de um node depende de uma saída anterior que ainda não
  existe
- **THEN** `flow_next` retorna bloqueio e o serviço rejeita receipt que tente
  ignorar a condição

**[pt]**

- **WHEN** um arquivo de flow muda depois que uma run iniciou
- **THEN** a run ativa continua com sua definição e identidade registradas

### Requirement: Guided runs have a complete lifecycle / Runs guiadas têm lifecycle completo

**[us]** The first `flow_next` SHALL start a created run. The scheduler SHALL
mark a run completed when all required nodes are completed or skipped, and
stopped when a stop rule matches. A paused run SHALL return no nodes and SHALL
reject checkpoints until resumed. CLI and MCP SHALL expose pause, resume, stop,
and fail actions.

**[pt]** A primeira chamada a `flow_next` SHALL iniciar uma run criada. O
scheduler SHALL marcar a run como concluída quando todos os nodes obrigatórios
forem concluídos ou ignorados, e como parada quando uma regra de parada for
acionada. Run pausada SHALL não retornar nodes e SHALL rejeitar checkpoints até
ser retomada. CLI e MCP SHALL expor ações de pausa, retomada, parada e falha.

#### Scenario: A run reaches done / A run chega ao fim

**[us]**

- **WHEN** every required node has a completed or scheduler-owned skipped receipt
- **THEN** `flow_next` returns `done` and persists the run as completed

**[pt]**

- **WHEN** todos os nodes obrigatórios têm receipt concluído ou ignorado pelo scheduler
- **THEN** `flow_next` retorna `done` e persiste a run como concluída

#### Scenario: A paused run is held / Uma run pausada fica suspensa

**[us]**

- **WHEN** `flow_next` or a checkpoint is requested for a paused run
- **THEN** no node is returned or recorded until the run is resumed

**[pt]**

- **WHEN** `flow_next` ou checkpoint é solicitado para uma run pausada
- **THEN** nenhum node é retornado ou registrado até a retomada da run

### Requirement: Run audit checks completion evidence / Auditoria da run valida evidências

**[us]** A run audit SHALL return `passed` only when the run is completed and
every node in its pinned definition has a completed or scheduler-owned skipped
receipt. Active or stopped runs SHALL be reported as `incomplete`; failed runs
or failed receipts SHALL be reported as `failed`.

**[pt]** A auditoria SHALL retornar `passed` somente quando a run estiver
concluída e todos os nodes da definição fixada tiverem receipt concluído ou
ignorado pelo scheduler. Runs ativas ou paradas SHALL ser reportadas como
`incomplete`; runs ou receipts com falha SHALL ser reportados como `failed`.

#### Scenario: An unfinished run is audited / Uma run incompleta é auditada

**[us]**

- **WHEN** a run is active, stopped, or lacks node evidence
- **THEN** the audit does not report `passed` and identifies missing evidence

**[pt]**

- **WHEN** a run está ativa, parada ou sem evidência de algum node
- **THEN** a auditoria não retorna `passed` e identifica a evidência ausente

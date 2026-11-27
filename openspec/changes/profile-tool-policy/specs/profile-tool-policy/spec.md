## ADDED Requirements

### Requirement: Each profile may set a tool policy / Cada perfil pode definir uma política de ferramentas

**[us]** The service SHALL support optional profile `skills` and `mcps` rule
lists with exact names, `*` wildcards, and leading `!` deny rules. A nonempty
list SHALL include a positive rule; deny matches SHALL take precedence. Empty
lists SHALL deny all. Optional MCP registration mappings SHALL be local to the
profile and runtime. An omitted policy SHALL preserve legacy behavior during
migration. Generic code SHALL contain no private organization names.

**[pt]** O serviço SHALL aceitar listas opcionais `skills` e `mcps` no perfil,
com nomes exatos, curingas `*` e regras de negação com `!` inicial. Lista não
vazia SHALL incluir regra positiva; correspondência negativa SHALL prevalecer.
Listas vazias SHALL proibir tudo. Mapeamentos opcionais de registro MCP SHALL
ser locais ao perfil e runtime. Política ausente SHALL preservar o comportamento
anterior na migração. Código genérico SHALL não conter nomes privados.

#### Scenario: Profile has no policy / Perfil não possui política

**[us]**

- **WHEN** a valid existing source has no `policy`
- **THEN** its flows remain eligible under legacy Skill rules and no profile-specific MCP is required

**[pt]**

- **WHEN** uma fonte válida existente não possui `policy`
- **THEN** seus flows seguem elegíveis pelas regras anteriores de Skills e nenhum MCP específico do perfil é exigido

#### Scenario: Empty Skill rules / Regras de Skills vazias

**[us]**

- **WHEN** a profile declares `skills: []` and a node declares a Skill
- **THEN** source validation rejects that node's Skill

**[pt]**

- **WHEN** um perfil declara `skills: []` e um nó declara uma Skill
- **THEN** a validação da fonte rejeita a Skill desse nó

#### Scenario: Deny-only rules / Regras apenas negativas

**[us]**

- **WHEN** a profile declares only `!*other*` without a positive rule
- **THEN** source-config validation rejects the policy and explains that broad access needs an explicit `*`

**[pt]**

- **WHEN** um perfil declara apenas `!*outro*` sem regra positiva
- **THEN** a validação rejeita a política e explica que permissão ampla exige `*` explícito

### Requirement: Declared Skills match the active profile / Skills declaradas correspondem ao perfil ativo

**[us]** The service SHALL match each declared node Skill ID against the
selected profile's rules during source validation and before a new run. A
Skill SHALL be allowed only when a positive rule matches and no deny rule
matches. A violation SHALL prevent that run and identify profile, flow, node,
and Skill. The global agent catalog SHALL NOT grant permission.

**[pt]** O serviço SHALL comparar cada ID de Skill do nó com as regras do perfil
na validação da fonte e antes de nova run. A Skill SHALL ser permitida somente
se corresponder a regra positiva e a nenhuma negativa. Uma violação SHALL
impedir a run e identificar perfil, flow, nó e Skill. O catálogo global do
agente SHALL NOT conceder permissão.

#### Scenario: Allowed Skill / Skill permitida

**[us]**

- **WHEN** a node declares a Skill matching a positive rule and no deny rule
- **THEN** policy validation accepts the Skill and normal flow checks continue

**[pt]**

- **WHEN** um nó declara uma Skill que corresponde a regra positiva e nenhuma negativa
- **THEN** a política aceita a Skill e as checagens normais do flow continuam

#### Scenario: Skill belongs to another profile / Skill pertence a outro perfil

**[us]**

- **WHEN** a node declares a Skill denied by the selected profile's pattern rules
- **THEN** validation rejects the affected flow with a stable error naming its profile, flow, node, and Skill, without requiring the other profile's MCP

**[pt]**

- **WHEN** um nó declara uma Skill negada pelas regras do perfil selecionado
- **THEN** a validação rejeita o flow afetado com código estável e nomes de perfil, flow, nó e Skill, sem exigir MCP do outro perfil

#### Scenario: Deny wins over broad allow / Negação prevalece sobre permissão ampla

**[us]**

- **WHEN** `skills: ["*", "!*other*"]` matches a declared Skill with both rules
- **THEN** validation rejects that Skill even though `*` matches it

**[pt]**

- **WHEN** `skills: ["*", "!*outro*"]` corresponde a uma Skill pelas duas regras
- **THEN** a validação rejeita a Skill mesmo com correspondência ao `*`

#### Scenario: Flow changes after validation / Flow muda após validação

**[us]**

- **WHEN** a flow YAML gains a forbidden Skill after a prior successful validation
- **THEN** new run creation rejects the changed flow before it is pinned or executed

**[pt]**

- **WHEN** um YAML ganha uma Skill proibida após validação anterior bem-sucedida
- **THEN** a criação de nova run rejeita o flow alterado antes de fixá-lo ou executá-lo

### Requirement: Each node declares its permitted MCP use / Cada nó declara seu uso permitido de MCPs

**[us]** A flow node MAY declare `mcps` as logical names. The service SHALL
match both each logical name and its resolved runtime registration against the
selected profile's MCP rules during source validation and before a new run.
Permission SHALL be scoped to the node, not its agent role. A node without
`mcps` SHALL have no profile MCP requirement.

**[pt]** Um nó MAY declarar `mcps` como nomes lógicos. O serviço SHALL comparar
cada nome lógico e seu registro resolvido no runtime com as regras MCP do
perfil na validação da fonte e antes de nova run. A permissão SHALL pertencer
ao nó, não ao papel do agente. Nó sem `mcps` SHALL não exigir MCP do perfil.

#### Scenario: Agent role is reused / Papel de agente é reutilizado

**[us]**

- **WHEN** two nodes use the same agent role but only one declares an allowed MCP alias
- **THEN** only the declaring node receives that MCP in its guided instructions

**[pt]**

- **WHEN** dois nós usam o mesmo agente, mas só um declara um MCP permitido
- **THEN** só o nó que declara o MCP recebe sua indicação nas instruções guiadas

#### Scenario: Node names a denied MCP / Nó declara MCP proibido

**[us]**

- **WHEN** a node declares an MCP name denied by the selected profile's rules
- **THEN** validation rejects the flow with a stable error naming the profile, flow, node, and alias

**[pt]**

- **WHEN** um nó declara MCP negado pelas regras do perfil selecionado
- **THEN** a validação rejeita o flow com código estável e perfil, flow, nó e nome lógico

#### Scenario: Safe alias maps to a denied registration / Nome lógico permitido aponta para registro proibido

**[us]**

- **WHEN** an allowed logical MCP name maps to a runtime registration denied by `policy.mcps`
- **THEN** source validation rejects the affected node before a run starts

**[pt]**

- **WHEN** um nome lógico permitido aponta para registro negado por `policy.mcps`
- **THEN** a validação rejeita o nó afetado antes de iniciar uma run

### Requirement: Plugin validates policies on every installation / Plugin valida políticas em toda instalação

**[us]** The plugin SHALL validate source policy syntax and declared node
tools when a source is configured and when an installed plugin starts or
updates. It SHALL report invalid rules and affected profile, flow, node, and
runtime without changing user files. Shipped agent guidance SHALL explain
`*`, `!`, deny precedence, and the limits of name-based rules with generic
examples. A clean install with no source SHALL request setup, not report a
policy failure.

**[pt]** O plugin SHALL validar regras da fonte e ferramentas dos nós quando
uma fonte é configurada e quando o plugin instalado inicia ou atualiza. Ele
SHALL informar regras inválidas e perfil, flow, nó e runtime afetados sem
alterar arquivos do usuário. As instruções distribuídas aos agentes SHALL
explicar `*`, `!`, prioridade da negação e limites dos padrões por nome com
exemplos genéricos. Instalação limpa sem fonte SHALL orientar a configuração,
sem indicar falha de política.

#### Scenario: Invalid rule on another installation / Regra inválida em outra instalação

**[us]**

- **WHEN** a developer configures a profile with only `!*other*` on a fresh installation
- **THEN** the plugin reports the invalid policy and how to add explicit `*`, without starting a run or rewriting the config

**[pt]**

- **WHEN** um dev configura perfil apenas com `!*outro*` em nova instalação
- **THEN** o plugin informa a política inválida e como adicionar `*` explícito, sem iniciar run ou reescrever a configuração

### Requirement: Doctor checks only MCPs used by the selected flow / Doctor confere somente MCPs usados pelo flow selecionado

**[us]** `doctor` SHALL inspect only MCP aliases declared by nodes of the
selected flow, resolved through its profile for the primary and configured
fallback runtime. It SHALL NOT infer an MCP requirement from a Skill name or
inspect unused aliases or another profile's MCPs. The `flow-server` MCP bridge
check remains independent.

**[pt]** O `doctor` SHALL inspecionar apenas MCPs declarados pelos nós do flow
selecionado e resolvidos pelo perfil no runtime principal e no fallback
configurado. Ele SHALL NOT inferir exigência de MCP pelo nome da Skill nem
consultar nomes não usados ou MCPs de outro perfil. A checagem do bridge MCP
`flow-server` continua independente.

#### Scenario: One profile lacks another profile's MCP / Perfil não possui MCP de outro perfil

**[us]**

- **WHEN** the selected flow has no node using an MCP from another profile
- **THEN** `doctor` does not check or fail on that MCP

**[pt]**

- **WHEN** nenhum nó do flow selecionado usa um MCP de outro perfil
- **THEN** o `doctor` não verifica nem falha por causa desse MCP

#### Scenario: Required fallback MCP is missing / MCP do fallback está ausente

**[us]**

- **WHEN** a node uses an MCP whose fallback runtime registration is missing
- **THEN** `doctor` reports that runtime and MCP as missing without checking other profiles

**[pt]**

- **WHEN** um nó usa um MCP cujo registro no runtime de fallback está ausente
- **THEN** o `doctor` informa runtime e MCP ausentes sem verificar outros perfis

#### Scenario: Unused MCP in the same profile / MCP não usado no mesmo perfil

**[us]**

- **WHEN** a profile allows an MCP alias but no node in the selected flow declares it
- **THEN** `doctor` does not require that MCP registration for this flow

**[pt]**

- **WHEN** um perfil permite um MCP, mas nenhum nó do flow selecionado o declara
- **THEN** o `doctor` não exige o registro desse MCP para este flow

### Requirement: Agent uses only declared tools / Agente usa somente ferramentas declaradas

**[us]** Guided node instructions SHALL tell the agent to use only Skills and
MCP aliases declared by the node and permitted by its active profile. A
global catalog entry SHALL NOT authorize additional tools.

**[pt]** As instruções de um nó guiado SHALL orientar o agente a usar somente
Skills e MCPs declarados pelo nó e permitidos pelo perfil ativo. Uma entrada
no catálogo global SHALL NOT autorizar ferramentas adicionais.

#### Scenario: Similar Skill exists globally / Skill semelhante existe no catálogo global

**[us]**

- **WHEN** the global catalog contains an undeclared Skill with a relevant description
- **THEN** node instructions exclude it from the guided task

**[pt]**

- **WHEN** o catálogo global contém uma Skill não declarada com descrição relevante
- **THEN** as instruções do nó a excluem da tarefa guiada

## ADDED Requirements

### Requirement: Herdr is the single installation entrypoint / Herdr é o ponto único de instalação

**[us]** `herdr plugin install` SHALL install the plugin UI, `flow-server`, local
CLI, schemas, agent Skills and instructions, and starter examples. The package
installation SHALL be non-interactive and idempotent.

**[pt]** `herdr plugin install` SHALL instalar UI do plugin, `flow-server`, CLI
local, schemas, Skills e instruções do agente e exemplos iniciais. A instalação
do pacote SHALL ser não interativa e idempotente.

#### Scenario: Plugin is installed again / Plugin é instalado novamente

**[us]**

- **WHEN** a developer updates or reinstalls the plugin
- **THEN** plugin-owned files are updated and personal flows and source configuration remain unchanged

**[pt]**

- **WHEN** um desenvolvedor atualiza ou reinstala o plugin
- **THEN** arquivos do plugin são atualizados e flows pessoais e configuração permanecem intactos

### Requirement: First use configures source ownership / Primeiro uso configura ownership da fonte

**[us]** The plugin SHALL show onboarding when no source exists and SHALL let the
developer choose local-only storage or a user-owned Git worktree. It SHALL store
no Git credential and SHALL make the selected local path visible before saving.

**[pt]** O plugin SHALL mostrar onboarding quando nenhuma fonte existir e SHALL
permitir que o desenvolvedor escolha armazenamento apenas local ou worktree Git
do próprio usuário. Ele SHALL não armazenar credencial Git e SHALL mostrar o path
local selecionado antes de salvar.

#### Scenario: Developer chooses local-only mode / Desenvolvedor escolhe modo somente local

**[us]**

- **WHEN** the developer selects `local` and confirms a directory
- **THEN** the plugin configures that directory without creating a Git repository or contacting a network service

**[pt]**

- **WHEN** o desenvolvedor seleciona `local` e confirma um diretório
- **THEN** o plugin configura esse diretório sem criar repositório Git ou contatar serviço de rede

#### Scenario: Developer chooses a repository / Desenvolvedor escolhe um repositório

**[us]**

- **WHEN** the developer selects `git` and provides a repository and destination
- **THEN** the plugin records non-secret configuration and hands the explicit clone task to the developer's agent

**[pt]**

- **WHEN** o desenvolvedor seleciona `git` e informa repositório e destino
- **THEN** o plugin registra configuração não secreta e entrega a tarefa explícita de clone ao agente

### Requirement: Starter flows remain separate from personal flows / Flows iniciais ficam separados dos flows pessoais

**[us]** Starter flows SHALL remain plugin-owned and read-only until explicitly
imported. Import SHALL NOT overwrite a personal flow with the same ID or path.

**[pt]** Flows iniciais SHALL permanecer sob ownership do plugin e read-only até
importação explícita. A importação SHALL NOT sobrescrever flow pessoal com o
mesmo ID ou path.

#### Scenario: Imported ID already exists / ID importado já existe

**[us]**

- **WHEN** a developer imports an example whose ID already exists in the personal source
- **THEN** the import stops and reports the conflict without changing either file

**[pt]**

- **WHEN** um desenvolvedor importa exemplo cujo ID já existe na fonte pessoal
- **THEN** a importação para e informa o conflito sem mudar nenhum arquivo

### Requirement: Agent follows configured Git synchronization policy / Agente segue a política Git configurada

**[us]** Installed agent instructions SHALL require flow validation and a
flow-only diff review before commit or push. The agent SHALL use the developer's
existing Git environment and SHALL NOT request credentials for the product.

**[pt]** As instruções instaladas SHALL exigir validação do flow e revisão do
diff somente do flow antes de commit ou push. O agente SHALL usar o ambiente Git
existente do desenvolvedor e SHALL NOT pedir credenciais para o produto.

#### Scenario: Push policy is after-validation / Política de push é after-validation

**[us]**

- **WHEN** only intended flow files changed, all changed flows pass validation,
  the branch and remote match configuration, and policy is `after-validation`
- **THEN** the agent may commit and push only those validated files without a new confirmation

**[pt]**

- **WHEN** somente arquivos de flow pretendidos mudaram, todos passam na
  validação, branch e remote correspondem à configuração e a política é
  `after-validation`
- **THEN** o agente pode fazer commit e push somente desses arquivos validados sem nova confirmação

#### Scenario: Worktree contains unrelated changes / Worktree contém mudanças não relacionadas

**[us]**

- **WHEN** automatic synchronization finds unrelated changes, conflicts,
  detached HEAD, an unexpected remote, or failed flow validation
- **THEN** the agent refuses automatic commit and push and reports the exact blocker

**[pt]**

- **WHEN** sincronização automática encontra mudanças não relacionadas,
  conflitos, detached HEAD, remote inesperado ou falha de validação
- **THEN** o agente recusa commit e push automáticos e informa o bloqueio exato

### Requirement: Remote flow updates require confirmation / Atualizações remotas de flow exigem confirmação

**[us]** The product SHALL NOT automatically pull or activate remote flow
changes. The agent SHALL show the available update and receive confirmation
before pulling it. An active run SHALL never change its selected definition.

**[pt]** O produto SHALL NOT fazer pull ou ativar automaticamente alterações
remotas de flow. O agente SHALL mostrar a atualização disponível e receber
confirmação antes do pull. Uma run ativa nunca muda sua definição selecionada.

#### Scenario: Remote branch has new flow instructions / Branch remota tem novas instruções de flow

**[us]**

- **WHEN** the configured remote branch has changes not present locally
- **THEN** the agent reports the change and does not pull or activate it without confirmation

**[pt]**

- **WHEN** a branch remota configurada tem mudanças que não existem localmente
- **THEN** o agente informa a mudança e não faz pull nem ativa sem confirmação

### Requirement: Change hooks report but do not mutate Git / Hooks informam mas não alteram Git

**[us]** A local hook SHALL mark a source as having pending validated changes.
The hook SHALL NOT commit, pull, push, change remotes, or modify credentials.

**[pt]** Um hook local SHALL marcar uma fonte como tendo alterações validadas
pendentes. O hook SHALL NOT fazer commit, pull, push, mudar remotes ou modificar
credenciais.

#### Scenario: A flow file changes / Um arquivo de flow muda

**[us]**

- **WHEN** a configured flow file changes
- **THEN** the hook marks the source pending and leaves all Git state unchanged

**[pt]**

- **WHEN** um arquivo de flow configurado muda
- **THEN** o hook marca a fonte como pendente e deixa todo estado Git inalterado

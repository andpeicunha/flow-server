# Tasks / Tarefas

## 1. Contracts and schemas / Contratos e schemas

**[us]**

- [x] Define the versioned local source configuration schema for `local` and
  `git` modes.
- [x] Define `manual`, `confirm`, and `after-validation` push policies and the
  confirmed pull policy.
- [x] Define the restricted YAML subset, resource limits, and canonical flow
  identity contract.
- [x] Define compatibility behavior for existing JSON flows.

**[pt]**

- [x] Definir o schema versionado de configuração de fonte local para modos
  `local` e `git`.
- [x] Definir políticas de push `manual`, `confirm` e `after-validation` e a
  política confirmada de pull.
- [x] Definir o subconjunto YAML restrito, limites de recursos e contrato de
  identidade canônica do flow.
- [x] Definir compatibilidade para flows JSON existentes.

## 2. flow-server source support / Suporte de fontes no flow-server

**[us]**

- [x] Add safe configuration loading without implicit `$HOME` discovery.
- [x] Add restricted YAML parsing and reject unsafe or ambiguous YAML features.
- [x] Validate YAML and JSON through one strict versioned schema.
- [x] Canonicalize valid flows deterministically and calculate their content
  hashes.
- [x] Record source ID, canonical hash, and optional Git commit in run metadata.
- [x] Expose read-only source status and validation results for the UI and agent.
- [x] Add local-mode versioned backup support without changing active runs.

**[pt]**

- [x] Adicionar leitura segura de configuração sem descoberta implícita no
  `$HOME`.
- [x] Adicionar parsing YAML restrito e rejeitar recursos YAML inseguros ou
  ambíguos.
- [x] Validar YAML e JSON por um único schema versionado e estrito.
- [x] Canonicalizar flows válidos de forma determinística e calcular seus hashes.
- [x] Registrar ID da fonte, hash canônico e commit Git opcional nos metadados da
  run.
- [x] Expor status read-only da fonte e resultados de validação para UI e agente.
- [x] Adicionar backup local versionado sem mudar runs ativas.

## 3. Herdr packaging and onboarding / Empacotamento e onboarding no Herdr

**[us]**

- [x] Package the plugin UI, `flow-server`, CLI, schemas, Skills, instructions,
  and starter examples behind `herdr plugin install`.
- [x] Keep the package installation step non-interactive and idempotent.
- [x] Add first-use onboarding when no source is configured.
- [x] Add local-directory selection and creation.
- [x] Add Git worktree selection and an agent handoff for an approved clone.
- [x] Add source status, validation errors, pending-change state, and sync policy
  display.
- [x] Keep official examples outside personal directories until explicit import.
- [x] Prove a plugin update does not overwrite personal flows or configuration.

**[pt]**

- [x] Empacotar UI do plugin, `flow-server`, CLI, schemas, Skills, instruções e
  exemplos iniciais atrás de `herdr plugin install`.
- [x] Manter a instalação do pacote não interativa e idempotente.
- [x] Adicionar onboarding no primeiro uso quando nenhuma fonte estiver
  configurada.
- [x] Adicionar seleção e criação de diretório local.
- [x] Adicionar seleção de worktree Git e handoff para o agente executar clone
  aprovado.
- [x] Adicionar exibição de status, erros de validação, mudanças pendentes e
  política de sync.
- [x] Manter exemplos oficiais fora de diretórios pessoais até importação
  explícita.
- [x] Provar que uma atualização do plugin não sobrescreve flows pessoais nem
  configuração.

## 4. Agent workflow and hooks / Workflow do agente e hooks

**[us]**

- [x] Create the installed Skill and agent instructions for safe flow editing,
  validation, diff review, commit, push, pull, and rollback.
- [x] Add a local hook that marks changed flows as pending without running Git
  mutations.
- [x] Require validation before an agent may commit or push a flow change.
- [x] Refuse automatic sync with unrelated changes, conflicts, detached HEAD,
  unexpected remotes, or failed validation.
- [x] Stage only intended flow files and approved metadata.
- [x] Apply the configured push policy and require confirmation for pull.
- [x] Record the effective flow hash and Git commit in the run dossier.

**[pt]**

- [x] Criar a Skill instalada e instruções do agente para edição segura,
  validação, revisão de diff, commit, push, pull e rollback de flows.
- [x] Adicionar hook local que marca flows alterados como pendentes sem executar
  mutações Git.
- [x] Exigir validação antes de o agente fazer commit ou push de um flow.
- [x] Recusar sync automático com mudanças não relacionadas, conflitos, detached
  HEAD, remotes inesperados ou falha de validação.
- [x] Adicionar ao stage somente arquivos de flow pretendidos e metadados
  aprovados.
- [x] Aplicar a política de push configurada e exigir confirmação para pull.
- [x] Registrar hash efetivo do flow e commit Git no dossiê da run.

## 5. Verification and documentation / Verificação e documentação

**[us]**

- [x] Add unit tests for source path containment, YAML restrictions, schema
  validation, canonicalization, and stable hashes.
- [x] Add integration tests for local and Git worktree modes without network or
  real credentials.
- [x] Add install and update tests proving separation of plugin-owned and
  user-owned content.
- [x] Add agent workflow tests for every sync policy and refusal condition.
- [x] Run an end-to-end Herdr onboarding, example import, flow edit, validation,
  guided run, and approved Git synchronization test.
- [x] Update README and local setup docs; mark VPS and remote MCP as deferred.
- [x] Run `npm test`, `npm run check:public`, and strict OpenSpec validation.

**[pt]**

- [x] Adicionar testes unitários para contenção de path, restrições YAML,
  validação de schema, canonicalização e hashes estáveis.
- [x] Adicionar testes de integração para modos local e worktree Git sem rede ou
  credenciais reais.
- [x] Adicionar testes de instalação e update que provem a separação entre
  conteúdo do plugin e do usuário.
- [x] Adicionar testes do workflow do agente para cada política de sync e
  condição de recusa.
- [x] Executar teste end-to-end de onboarding no Herdr, importação de exemplo,
  edição, validação, guided run e sincronização Git aprovada.
- [x] Atualizar README e docs locais; marcar VPS e MCP remoto como adiados.
- [x] Executar `npm test`, `npm run check:public` e validação OpenSpec estrita.

## 6. Agent workflow v2 and private profile routing / Workflow de agents v2 e profiles locais

**[us]**

- [x] Accept and normalize existing agent workflow YAML fields without editing
  private flow files.
- [x] Add local workspace-root mappings and unique-match profile resolution.
- [x] Scope same-named flows and run identities by private profile/source.
- [x] Return a confirmation decision without creating a run when workspace or
  flow resolution is ambiguous.
- [x] Schedule ready nodes with their configured agents, models, effort,
  executors, Skills, constraints, conditions, and stop rules.
- [x] Add structured bounded node output to receipts for downstream conditions.
- [x] Preserve task and completed-node context in rendered prompts.
- [x] Treat conditional skips as satisfied dependencies at branch joins.
- [x] Ask for confirmation when routing matches multiple flows, regardless of
  priority.
- [x] Complete run lifecycle through CLI, MCP, and the scheduler.
- [x] Read the current Git identity when resolving a run.
- [x] Compare string conditions and stop rules without case sensitivity.
- [x] Ignore stop rules for intentionally skipped nodes.
- [x] Report incomplete audits unless every required node has evidence.
- [x] Refresh Git identity in source and flow listings.
- [x] Update installed Skill and setup documentation with generic profile
  mapping, selection, and node execution instructions.
- [x] Run focused and full local validation; record any environment-blocked
  checks.

**[pt]**

- [x] Aceitar e normalizar os campos dos workflows existentes sem editar flows
  privados.
- [x] Adicionar mapeamento local de workspace e resolução por correspondência
  única de profile.
- [x] Isolar flows homônimos e identidade de run por profile/fonte privada.
- [x] Retornar pedido de confirmação sem criar run quando workspace ou flow
  forem ambíguos.
- [x] Agendar nodes prontos com agente, modelo, esforço, executor, Skills,
  restrições, condições e regras de parada configurados.
- [x] Adicionar saída estruturada e limitada nos receipts para condições
  posteriores.
- [x] Preservar task e contexto de nodes concluídos nos prompts renderizados.
- [x] Tratar branches condicionais ignorados como dependências resolvidas em
  joins.
- [x] Pedir confirmação quando o roteamento corresponder a vários flows,
  independentemente da prioridade.
- [x] Completar o lifecycle da run pela CLI, MCP e scheduler.
- [x] Ler a identidade Git atual ao resolver a run.
- [x] Comparar conditions e stop rules sem diferenciar maiúsculas e minúsculas.
- [x] Ignorar stop rules de nodes intencionalmente ignorados.
- [x] Reportar auditoria incompleta sem evidência de todos os nodes obrigatórios.
- [x] Atualizar a identidade Git nas listagens de fontes e flows.
- [x] Atualizar a Skill instalada e a documentação com configuração genérica de
  profiles, seleção e execução de nodes.
- [x] Executar validações focadas e completas; testes de container foram
  ignorados porque dependem de Docker.

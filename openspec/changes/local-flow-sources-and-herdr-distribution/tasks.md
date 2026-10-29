# Tasks / Tarefas

## 1. Contracts and schemas / Contratos e schemas

**[us]**

- [ ] Define the versioned local source configuration schema for `local` and
  `git` modes.
- [ ] Define `manual`, `confirm`, and `after-validation` push policies and the
  confirmed pull policy.
- [ ] Define the restricted YAML subset, resource limits, and canonical flow
  identity contract.
- [ ] Define compatibility behavior for existing JSON flows.

**[pt]**

- [ ] Definir o schema versionado de configuração de fonte local para modos
  `local` e `git`.
- [ ] Definir políticas de push `manual`, `confirm` e `after-validation` e a
  política confirmada de pull.
- [ ] Definir o subconjunto YAML restrito, limites de recursos e contrato de
  identidade canônica do flow.
- [ ] Definir compatibilidade para flows JSON existentes.

## 2. flow-server source support / Suporte de fontes no flow-server

**[us]**

- [ ] Add safe configuration loading without implicit `$HOME` discovery.
- [ ] Add restricted YAML parsing and reject unsafe or ambiguous YAML features.
- [ ] Validate YAML and JSON through one strict versioned schema.
- [ ] Canonicalize valid flows deterministically and calculate their content
  hashes.
- [ ] Record source ID, canonical hash, and optional Git commit in run metadata.
- [ ] Expose read-only source status and validation results for the UI and agent.
- [ ] Add local-mode versioned backup support without changing active runs.

**[pt]**

- [ ] Adicionar leitura segura de configuração sem descoberta implícita no
  `$HOME`.
- [ ] Adicionar parsing YAML restrito e rejeitar recursos YAML inseguros ou
  ambíguos.
- [ ] Validar YAML e JSON por um único schema versionado e estrito.
- [ ] Canonicalizar flows válidos de forma determinística e calcular seus hashes.
- [ ] Registrar ID da fonte, hash canônico e commit Git opcional nos metadados da
  run.
- [ ] Expor status read-only da fonte e resultados de validação para UI e agente.
- [ ] Adicionar backup local versionado sem mudar runs ativas.

## 3. Herdr packaging and onboarding / Empacotamento e onboarding no Herdr

**[us]**

- [ ] Package the plugin UI, `flow-server`, CLI, schemas, Skills, instructions,
  and starter examples behind `herdr plugin install`.
- [ ] Keep the package installation step non-interactive and idempotent.
- [ ] Add first-use onboarding when no source is configured.
- [ ] Add local-directory selection and creation.
- [ ] Add Git worktree selection and an agent handoff for an approved clone.
- [ ] Add source status, validation errors, pending-change state, and sync policy
  display.
- [ ] Keep official examples outside personal directories until explicit import.
- [ ] Prove a plugin update does not overwrite personal flows or configuration.

**[pt]**

- [ ] Empacotar UI do plugin, `flow-server`, CLI, schemas, Skills, instruções e
  exemplos iniciais atrás de `herdr plugin install`.
- [ ] Manter a instalação do pacote não interativa e idempotente.
- [ ] Adicionar onboarding no primeiro uso quando nenhuma fonte estiver
  configurada.
- [ ] Adicionar seleção e criação de diretório local.
- [ ] Adicionar seleção de worktree Git e handoff para o agente executar clone
  aprovado.
- [ ] Adicionar exibição de status, erros de validação, mudanças pendentes e
  política de sync.
- [ ] Manter exemplos oficiais fora de diretórios pessoais até importação
  explícita.
- [ ] Provar que uma atualização do plugin não sobrescreve flows pessoais nem
  configuração.

## 4. Agent workflow and hooks / Workflow do agente e hooks

**[us]**

- [ ] Create the installed Skill and agent instructions for safe flow editing,
  validation, diff review, commit, push, pull, and rollback.
- [ ] Add a local hook that marks changed flows as pending without running Git
  mutations.
- [ ] Require validation before an agent may commit or push a flow change.
- [ ] Refuse automatic sync with unrelated changes, conflicts, detached HEAD,
  unexpected remotes, or failed validation.
- [ ] Stage only intended flow files and approved metadata.
- [ ] Apply the configured push policy and require confirmation for pull.
- [ ] Record the effective flow hash and Git commit in the run dossier.

**[pt]**

- [ ] Criar a Skill instalada e instruções do agente para edição segura,
  validação, revisão de diff, commit, push, pull e rollback de flows.
- [ ] Adicionar hook local que marca flows alterados como pendentes sem executar
  mutações Git.
- [ ] Exigir validação antes de o agente fazer commit ou push de um flow.
- [ ] Recusar sync automático com mudanças não relacionadas, conflitos, detached
  HEAD, remotes inesperados ou falha de validação.
- [ ] Adicionar ao stage somente arquivos de flow pretendidos e metadados
  aprovados.
- [ ] Aplicar a política de push configurada e exigir confirmação para pull.
- [ ] Registrar hash efetivo do flow e commit Git no dossiê da run.

## 5. Verification and documentation / Verificação e documentação

**[us]**

- [ ] Add unit tests for source path containment, YAML restrictions, schema
  validation, canonicalization, and stable hashes.
- [ ] Add integration tests for local and Git worktree modes without network or
  real credentials.
- [ ] Add install and update tests proving separation of plugin-owned and
  user-owned content.
- [ ] Add agent workflow tests for every sync policy and refusal condition.
- [ ] Run an end-to-end Herdr onboarding, example import, flow edit, validation,
  guided run, and approved Git synchronization test.
- [ ] Update README and local setup docs; mark VPS and remote MCP as deferred.
- [ ] Run `npm test`, `npm run check:public`, and strict OpenSpec validation.

**[pt]**

- [ ] Adicionar testes unitários para contenção de path, restrições YAML,
  validação de schema, canonicalização e hashes estáveis.
- [ ] Adicionar testes de integração para modos local e worktree Git sem rede ou
  credenciais reais.
- [ ] Adicionar testes de instalação e update que provem a separação entre
  conteýo do plugin e do usuário.
- [ ] Adicionar testes do workflow do agente para cada política de sync e
  condição de recusa.
- [ ] Executar teste end-to-end de onboarding no Herdr, importação de exemplo,
  edição, validação, guided run e sincronização Git aprovada.
- [ ] Atualizar README e docs locais; marcar VPS e MCP remoto como adiados.
- [ ] Executar `npm test`, `npm run check:public` e validação OpenSpec estrita.

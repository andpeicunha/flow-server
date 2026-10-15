# Tasks / Tarefas

## Design and approval / Design e aprovação

**[us]**

- [x] Define remote flow discovery and approved flow delivery.
- [x] Define `flow_recommend` and `flow_get_definition` boundaries.
- [x] Define flow ID, version, hash, schema, and local validation rules.
- [x] Define redacted run evidence and continuous-improvement proposal rules.
- [x] Define evidence schema, identifier, size, status, and source-version validation.
- [x] Define analysis sufficiency and server-generated proposal metadata rules.
- [ ] Review the catalog trust model and approval process.

## Implementation / Implementação

**[us]**

- [ ] Add versioned approved-flow storage with deterministic content hashes.
- [ ] Add a remote catalog domain for recommendation and exact definition lookup.
- [ ] Add strict redacted-evidence validation and server-generated evidence IDs.
- [ ] Add safe run listing, evidence lookup, analysis, and `pending_review` proposals.
- [ ] Add the separate `flow-remote-mcp` stdio entrypoint and bounded tools.
- [ ] Require a configured bearer token and keep it out of errors and logs.
- [ ] Add unit and integration tests for authorization, catalog lookup, validation,
  redaction, analysis, and non-mutation guarantees.
- [ ] Update public documentation with local development and test commands.

**[pt]**

- [ ] Adicionar armazenamento de flow aprovado e versionado com hashes de conteúdo determinísticos.
- [ ] Adicionar domínio de catálogo remoto para recomendação e busca exata de definição.
- [ ] Adicionar validação estrita de evidência redigida e IDs de evidência gerados pelo servidor.
- [ ] Adicionar listagem segura de runs, busca de evidência, análise e propostas `pending_review`.
- [ ] Adicionar entrypoint stdio separado `flow-remote-mcp` e tools limitadas.
- [ ] Exigir bearer token configurado e mantê-lo fora de erros e logs.
- [ ] Adicionar testes unitários e de integração para autorização, busca de catálogo,
  validação, redaction, análise e garantias de não mutação.
- [ ] Atualizar documentação pública com comandos locais de desenvolvimento e teste.

**[pt]**

- [x] Definir descoberta remota de flows e entrega de flow aprovado.
- [x] Definir limites de `flow_recommend` e `flow_get_definition`.
- [x] Definir regras de ID, versão, hash, schema e validação local de flow.
- [x] Definir regras de evidência redigida de run e proposta de melhoria contínua.
- [x] Definir validação de schema, identificador, tamanho, status e versão de origem da evidência.
- [x] Definir regras de suficiência para análise e metadados de proposta gerados pelo servidor.
- [ ] Revisar o trust model do catálogo e processo de aprovação.
- [ ] Aprovar change de implementação separada antes de criar serviços remotos.

## Explicitly deferred / Explicitamente adiado

**[us]**

- [ ] Provision remote infrastructure, WorkOS OAuth, deployment, or production credentials.
- [ ] Run an agent, shell command, or flow remotely.
- [ ] Read or write repositories, workspaces, runs, receipts, or audit records remotely.
- [ ] Apply or publish an improvement proposal automatically.

**[pt]**

- [ ] Provisionar infraestrutura, identidade, deploy ou credenciais remotas.
- [ ] Executar agente, comando shell ou flow remotamente.
- [ ] Ler ou escrever repositórios, workspaces, runs, receipts ou auditorias remotamente.
- [ ] Aplicar ou publicar proposta de melhoria automaticamente.

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

**[pt]**

- [x] Definir descoberta remota de flows e entrega de flow aprovado.
- [x] Definir limites de `flow_recommend` e `flow_get_definition`.
- [x] Definir regras de ID, versão, hash, schema e validação local de flow.
- [x] Definir regras de evidência redigida de run e proposta de melhoria contínua.
- [x] Definir validação de schema, identificador, tamanho, status e versão de origem da evidência.
- [x] Definir regras de suficiência para análise e metadados de proposta gerados pelo servidor.
- [ ] Revisar o trust model do catálogo e processo de aprovação.

## Implementation / Implementação

**[us]**

- [x] Add versioned approved-flow storage with deterministic content hashes.
- [x] Add a remote catalog domain for recommendation and exact definition lookup.
- [x] Add strict redacted-evidence validation and server-generated evidence IDs.
- [x] Add safe run listing, evidence lookup, analysis, and `pending_review` proposals.
- [x] Add the separate `flow-remote-mcp` stdio entrypoint and bounded tools.
- [x] Require a configured bearer token and keep it out of errors and logs.
- [x] Add the authenticated HTTP MCP transport boundary without browser CORS access.
- [x] Add unit and integration tests for authorization, catalog lookup, validation,
  redaction, analysis, and non-mutation guarantees.
- [x] Update public documentation with local development and test commands.

**[pt]**

- [x] Adicionar armazenamento de flow aprovado e versionado com hashes de conteúdo determinísticos.
- [x] Adicionar domínio de catálogo remoto para recomendação e busca exata de definição.
- [x] Adicionar validação estrita de evidência redigida e IDs de evidência gerados pelo servidor.
- [x] Adicionar listagem segura de runs, busca de evidência, análise e propostas `pending_review`.
- [x] Adicionar entrypoint stdio separado `flow-remote-mcp` e tools limitadas.
- [x] Exigir bearer token configurado e mantê-lo fora de erros e logs.
- [x] Adicionar limite de transporte HTTP MCP autenticado sem acesso CORS de navegador.
- [x] Adicionar testes unitários e de integração para autorização, busca de catálogo,
  validação, redaction, análise e garantias de não mutação.
- [x] Atualizar documentação pública com comandos locais de desenvolvimento e teste.

## Explicitly deferred / Explicitamente adiado

**[us]**

- [ ] Provision remote infrastructure, WorkOS OAuth, deployment, or production credentials.
- [ ] Run an agent, shell command, or flow remotely.
- [ ] Read or write repositories, workspaces, runs, receipts, or audit records remotely.
- [ ] Apply or publish an improvement proposal automatically.

**[pt]**

- [ ] Provisionar infraestrutura remota, OAuth do WorkOS, deploy ou credenciais de produção.
- [ ] Executar agente, comando shell ou flow remotamente.
- [ ] Ler ou escrever repositórios, workspaces, runs, receipts ou auditorias remotamente.
- [ ] Aplicar ou publicar proposta de melhoria automaticamente.

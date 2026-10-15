# Design: remote flow catalog V2 / Catálogo remoto de flows V2

## Flow from prompt / Fluxo a partir do prompt

**[us]**

```text
Agent prompt -> flow_recommend(task summary) -> flow_get_definition(flowId, version)
             -> verify flowId, version, and content hash -> local runner executes
```

The remote catalog only delivers definitions. The local runner owns workspace
access, agent execution, checkpoints, receipts, and audit.

**[pt]**

```text
Prompt do agente -> flow_recommend(resumo) -> flow_get_definition(flowId, versão)
                  -> verificar flowId, versão e hash -> runner local executa
```

O catálogo remoto entrega apenas definições. O runner local é dono do acesso ao
workspace, execução de agente, checkpoints, receipts e auditoria.

## Catalog data / Dados do catálogo

**[us]**

Each approved flow has a stable `flowId`, semantic version, content hash,
title, short summary, supported task tags, and immutable definition. A changed
definition creates a new version and hash.

**[pt]**

Cada flow aprovado tem `flowId` estável, versão semântica, hash de conteúdo,
título, resumo curto, tags de tarefa suportadas e definição imutável. Uma
definição alterada cria nova versão e hash.

## MCP tools / Tools MCP

**[us]**

- `flow_recommend` accepts a small task summary and optional approved tags. It
  returns ranked metadata only: `flowId`, version, title, summary, and reason.
- `flow_get_definition` accepts a returned `flowId` and version. It returns the
  exact definition with its content hash and release metadata.

The MCP exposes no generic download, file access, URL fetch, shell, repository
access, agent execution, or write tool.

**[pt]**

- `flow_recommend` aceita resumo pequeno de tarefa e tags aprovadas opcionais.
  Ela retorna apenas metadados ordenados: `flowId`, versão, título, resumo e motivo.
- `flow_get_definition` aceita `flowId` e versão retornados. Ela retorna a
  definição exata com hash de conteúdo e metadados da release.

O MCP não expõe download genérico, acesso a arquivo, busca de URL, shell,
acesso a repositório, execução de agente ou tool de escrita.

## Safe run analysis and improvement / Análise segura de run e melhoria

**[us]**

The local runner may opt in to send redacted run events and receipts for an
approved flow version. Allowed evidence is flow ID, flow version, run ID, node
ID, status, duration, safe error code, and aggregate counters. It excludes raw
prompts, workspace paths, file bodies, tokens, secrets, and full agent output.

The MCP exposes these bounded tools:

- `flow_list_runs` returns safe run summaries for an approved flow version.
- `flow_get_run_evidence` returns redacted evidence for one run.
- `flow_record_run_evidence` accepts one redacted, validated evidence event.
- `flow_analyze_flow` returns evidence-based gaps and improvement suggestions.
- `flow_record_improvement_proposal` stores a draft linked to the source flow
  version and evidence IDs.

An improvement proposal has `pending_review` status. It cannot edit a draft,
publish a release, or change a running flow. A human review creates any new
flow version through a separate approval and publishing process.

The catalog validates every evidence event before it persists it: `flowId` and
version must name an approved release; `runId` and `nodeId` must use the
published identifier format; status must be one of the documented safe values;
duration and aggregate counters must be non-negative bounded numbers; and the
event must contain only approved fields. Unknown fields, oversized payloads,
duplicate event IDs, invalid status transitions, or prohibited content fail
closed with a safe error code.

`flow_analyze_flow` accepts only an approved flow ID and version and references
only stored, valid evidence. It must return no finding when the selected
evidence is absent or too small to support one. An improvement proposal must
reference valid evidence IDs from one source version, use a server-generated
proposal ID and date, and remain `pending_review`.

**[pt]**

O runner local pode optar por enviar eventos e receipts redigidos de uma run
para uma versão de flow aprovada. A evidência permitida é ID e versão do flow,
ID da run, ID do node, status, duração, código de erro seguro e contadores
agregados. Ela exclui prompts brutos, paths do workspace, corpo de arquivos,
tokens, secrets e saída completa do agente.

O MCP expõe estas tools limitadas:

- `flow_list_runs` retorna resumos seguros de runs para versão de flow aprovada.
- `flow_get_run_evidence` retorna evidência redigida de uma run.
- `flow_record_run_evidence` aceita um evento de evidência redigido e validado.
- `flow_analyze_flow` retorna gaps baseados em evidência e sugestões de melhoria.
- `flow_record_improvement_proposal` armazena draft ligado à versão de flow de
  origem e aos IDs de evidência.

Uma proposta de melhoria tem status `pending_review`. Ela não pode editar um
draft, publicar uma release ou mudar flow em execução. Uma revisão humana cria
qualquer nova versão de flow por processo separado de aprovação e publicação.

O catálogo valida cada evento de evidência antes de persistir: `flowId` e versão
devem indicar uma release aprovada; `runId` e `nodeId` devem usar o formato de
identificador publicado; status deve ser um dos valores seguros documentados;
duração e contadores agregados devem ser números não negativos e limitados; e o
evento deve conter somente campos aprovados. Campos desconhecidos, payloads
muito grandes, IDs de evento duplicados, transições inválidas de status ou
conteúdo proibido falham fechados com código de erro seguro.

`flow_analyze_flow` aceita somente ID e versão de flow aprovados e referencia
somente evidência válida já armazenada. Ela não deve retornar achado quando a
evidência selecionada estiver ausente ou for pequena demais para sustentá-lo.
Uma proposta de melhoria deve referenciar IDs de evidência válidos de uma versão
de origem, usar ID e data gerados pelo servidor e permanecer `pending_review`.

## Validation and failure / Validação e falha

**[us]**

The local runner verifies `flowId`, version, schema version, and content hash
before use. It rejects an unknown flow, changed content, unsupported schema,
missing dependency, or definition outside the configured allowlist.

The catalog rejects evidence and analysis requests that do not pass their
schema, allowlist, size, identifier, status, and source-version checks. It
records no rejected payload and returns only a safe error code. It treats an
analysis result as a suggestion, not as permission to modify a flow.

**[pt]**

O runner local verifica `flowId`, versão, versão do schema e hash do conteúdo
antes do uso. Ele rejeita flow desconhecido, conteúdo alterado, schema não
suportado, dependência ausente ou definição fora da allowlist configurada.

O catálogo rejeita requisições de evidência e análise que não passam pelas
verificações de schema, allowlist, tamanho, identificador, status e versão de
origem. Ele não registra payload rejeitado e retorna somente código de erro
seguro. Ele trata um resultado de análise como sugestão, não como permissão para
alterar um flow.

## Required tests before implementation / Testes obrigatórios antes da implementação

**[us]**

- Recommendation returns only approved metadata.
- Definition lookup requires an approved ID and exact version.
- Hash, schema, and version mismatches fail closed.
- MCP rejects arbitrary URLs, paths, shell, write, and repository requests.
- A local runner completes an end-to-end synthetic flow after verification.
- Evidence redaction removes prompts, paths, file bodies, tokens, and secrets.
- Evidence rejects unknown fields, oversized payloads, duplicate event IDs, and
  invalid status transitions without storing the payload.
- Analysis rejects an unapproved flow version or insufficient valid evidence.
- Improvement proposals require source version and evidence IDs.
- Improvement proposals use server-generated ID and date and remain
  `pending_review`.
- An MCP proposal cannot publish or change a running flow.

**[pt]**

- Recomendação retorna apenas metadados aprovados.
- Busca de definição exige ID aprovado e versão exata.
- Incompatibilidades de hash, schema e versão falham fechadas.
- MCP rejeita URL, path, shell, escrita e requisição de repositório arbitrários.
- Runner local completa flow sintético end-to-end após a verificação.
- Redaction de evidência remove prompts, paths, corpo de arquivo, tokens e secrets.
- Evidência rejeita campos desconhecidos, payloads muito grandes, IDs de evento
  duplicados e transições inválidas de status sem armazenar o payload.
- Análise rejeita versão de flow não aprovada ou evidência válida insuficiente.
- Propostas de melhoria exigem versão de origem e IDs de evidência.
- Propostas de melhoria usam ID e data gerados pelo servidor e permanecem
  `pending_review`.
- Uma proposta MCP não pode publicar ou mudar flow em execução.

## Implementation boundary / Limite de implementação

**[us]**

This change implements the remote catalog domain and its stdio MCP boundary in
this repository. It includes a configured bearer-token check, versioned flow
definitions, strict evidence validation, safe analysis, and proposal storage.
It does not deploy a VPS service or configure WorkOS. Deployment and WorkOS
OAuth will consume these bounded contracts in a later change.

**[pt]**

Esta change implementa o domínio do catálogo remoto e seu limite MCP por stdio
neste repositório. Ela inclui verificação de bearer token configurado,
definições de flow versionadas, validação estrita de evidência, análise segura e
armazenamento de propostas. Ela não faz deploy de serviço em VPS nem configura
WorkOS. Deploy e OAuth do WorkOS vão consumir estes contratos limitados em uma
change posterior.

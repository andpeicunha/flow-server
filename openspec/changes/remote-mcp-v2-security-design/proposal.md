# Remote flow catalog V2 / Catálogo remoto de flows V2

## Why / Por quê

**[us]**

An agent needs a safe way to choose an approved flow from a prompt. V1 stores
and runs flows locally. V2 defines a remote catalog that helps an agent find a
flow, receive its exact version, and continue execution locally.

**[pt]**

Um agente precisa de uma forma segura de escolher um flow aprovado a partir de
um prompt. A V1 armazena e executa flows localmente. A V2 define um catálogo
remoto que ajuda o agente a encontrar um flow, receber sua versão exata e
continuar a execução localmente.

## What changes / O que muda

**[us]**

Define a remote MCP flow catalog with `flow_recommend` and
`flow_get_definition`. The catalog returns approved flow metadata and immutable
flow definitions by ID, version, and content hash. The agent validates the
definition, then uses its local runner to execute the task. The catalog also
accepts redacted, approved run evidence for analysis and stores improvement
proposals for human review. It validates evidence against a strict allowlist,
approved flow version, safe status values, and bounded request sizes before it
stores or analyzes anything.

**[pt]**

Definir um catálogo remoto de flows por MCP com `flow_recommend` e
`flow_get_definition`. O catálogo retorna metadados de flow aprovados e
definições imutáveis por ID, versão e hash do conteúdo. O agente valida a
definição e usa seu runner local para executar a tarefa. O catálogo também
aceita evidência de run aprovada e redigida para análise e armazena propostas
de melhoria para revisão humana. Ele valida a evidência contra uma allowlist
estrita, versão aprovada de flow, valores seguros de status e tamanhos limitados
de requisição antes de armazenar ou analisar qualquer dado.

## Non-goals / Fora de escopo

**[us]**

- Execute agents, shell commands, or flows on the remote catalog.
- Read or write a local workspace, repository, run, receipt, or state directory.
- Return an arbitrary URL, path, file, or unapproved flow.
- Apply, publish, or replace a flow version automatically.
- Send raw prompts, secrets, workspace files, or full agent output as evidence.
- Provision a VPS, WorkOS, OAuth, GitHub App, token, Docker service, or deploy.
- Change the V1 local MCP bridge or expose its loopback service.

**[pt]**

- Executar agentes, comandos shell ou flows no catálogo remoto.
- Ler ou escrever workspace, repositório, run, receipt ou state directory local.
- Retornar URL, path, arquivo ou flow arbitrário e não aprovado.
- Aplicar, publicar ou substituir uma versão de flow automaticamente.
- Enviar prompts brutos, secrets, arquivos do workspace ou saída completa do
  agente como evidência.
- Provisionar VPS, WorkOS, OAuth, GitHub App, token, serviço Docker ou deploy.
- Alterar a bridge MCP local da V1 ou expor seu serviço loopback.

## Impact / Impacto

**[us]**

This is an implementation change for the V2 remote catalog package in this
repository. It adds the catalog domain, bounded remote MCP tools, strict
validation, and automated tests. V1 remains local-first and unchanged.

**[pt]**

Esta é uma change de implementação do pacote de catálogo remoto V2 neste
repositório. Ela adiciona domínio do catálogo, tools MCP remotas limitadas,
validação estrita e testes automatizados. A V1 continua local-first e sem
mudanças.

---

# AI Notes

## Instructions for AI Agents

When analyzing this document, treat every note with `Status: pending` as an active request.

After resolving a note:

1. Delete the entire `## NOTE-XXX` block from the document.

Unresolved notes must remain unchanged with `Status: pending`.

## NOTE-001

Status: pending

Lines: 13-18

Selected Text:

> Um agente precisa de uma forma segura de escolher um flow aprovado a partir de um prompt. A V1 armazena e executa flows localmente. A V2 define um catálogo remoto que ajuda o agente a encontrar um flow, receber sua versão exata e continuar a execução localmente.

Human Comment:

inclusive depois quero que nessa versão remota/cloud, seja possivel editar os flows, ajustar os nodes, modelo que será usado e tudo mais, inclusive é preciso prever os modelos, porque se for claude é uma coisa, se for codex é outra, podemos já na V2 ter essa configs dos modelos, alguma UI que permita editar os agentes, modelo e effort

Expected AI Action:

Not specified.

Created At:

2026-10-15 10:09

## NOTE-002

Status: pending

Lines: 29-32

Selected Text:

> Definir um catálogo remoto de flows por MCP com flow_recommend e flow_get_definition. O catálogo retorna metadados de flow aprovados e definições imutáveis por ID, versão e hash do conteúdo. O agente valida a definição e usa seu runner local para executar a tarefa.

Human Comment:

Sendo assim, nós conseguimos ter uma UI na VPS que permita acompanhar os flows rodando? isso? se o mcp já fornece o ID de cada flow, podemos analisar os flows. Seria interessante ter esse tipo de controle, inclusive pra entender melhorias no processo, melhorias nos fluxos, gpas que devem ser corrigidos, etc. ter essa comunicação do agente queestá executando com o mcp pra report dos nodes pode ser um caminho, como avalia isso?

Expected AI Action:

Not specified.

Created At:

2026-10-15 10:11

## NOTE-003

Status: pending

Lines: 49-49

Selected Text:

> - Provisionar VPS, WorkOS, OAuth, GitHub App, token, serviço Docker ou deploy.

Human Comment:

mas teremos que instalar na VPS e habilitar com o Workos o oauth no MCP, não é isso?

Expected AI Action:

Not specified.

Created At:

2026-10-15 10:12

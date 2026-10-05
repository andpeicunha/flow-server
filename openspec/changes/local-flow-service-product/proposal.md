# Flow-server como serviço local distribuível

## Why

O flow-server já preserva DAG YAML, checkpoints, receipts e auditoria local,
mas ainda é iniciado a partir de `opencode/flow-runner` e depende de paths do
dotfiles. O servidor HTTP atual também inicia runs diretamente. Isso mistura
produto, configuração pessoal, viewer e execução de agentes.

## What Changes

Definir a migração incremental para um produto local e público, sem mover
arquivos, alterar flows ou publicar pacotes nesta change. O destino é um novo
repositório público `flow-server` (nome de trabalho), separado do dotfiles. A
arquitetura alvo é:

- `flow-server-core`: YAML/DAG, schemas, estado, receipts e auditoria;
- `flow-service`: processo local, dono exclusivo do estado e API loopback;
- `flow-cli`: cliente para listar, iniciar, inspecionar, checkpointar e auditar;
- `flow-web`: viewer opcional;
- `runtime-adapters`: Codex e Claude, explicitamente selecionados;
- `flow-tui`: cliente Herdr opcional, fora do core;
- `profiles`: entradas externas, opt-in e nunca empacotadas por padrão.
- `flow-mcp`: bridge local para harnesses de agentes, consumindo só o serviço
  loopback;

## Escopo

- Contrato HTTP local, lifecycle, lock, PID, estado configurável e redaction.
- Contrato de CLI e camada temporária que mantém `flow` funcional.
- Descoberta externa de flows/profiles, com core público separado de overlays.
- Viewer/audit Docker somente leitura; executor Docker é explicitamente excluído.
- Layout e critérios de um exemplo público sintético e quickstart curto.
- Sequência de PRs, migração, rollback, compatibilidade e release.
- MCP local V1 para harnesses de agentes, sem login social, VPS, sincronização
  remota ou publicação de flows reais. O registry privado é uma change V2
  separada.

## Fora de escopo

- Mover ou renomear `opencode/flow-runner` ou `opencode/bin/flow`.
- Implementar registry, login social, VPS, sincronização remota, Dockerfile ou
  pacote npm.
- Copiar, publicar ou inspecionar conteúdo de profiles privados, sessões,
  credenciais, logs ou runs reais.
- Executar agentes em Docker, montar worktrees para execução em container, ou
  expor o serviço além do loopback.
- Alterar o contrato semântico dos flows legados nesta fase.
- Criar o repositório público, provisionar VPS, configurar login social ou
  migrar/enviar qualquer flow privado.

## Capacidades

### Novas

- `local-flow-service`
- `flow-cli-client`
- `external-flow-profiles`
- `docker-readonly-viewer-audit`
- `flow-web-observer-navigation`
- `local-flow-mcp-bridge`
- `public-flow-example-and-release`

### Modificadas

- `flow-server-product-boundary` e `runtime-neutral-flow-execution` da change
  `decouple-flow-server-runtime` são pré-requisitos arquiteturais. Esta change
  os torna um plano de produto local; não os implementa nem os substitui.

## Impacto e linha de base

- Linha de base: `npm test` em `opencode/flow-runner` passou com 50 testes.
- O comando atual `flow` fixa `$HOME/Apps/dotfiles/opencode/flow-runner`.
- O estado usa `~/.local/state/flow-runs`; flows e profiles estão sob o runner.
- `viewer.ts` já faz bind em loopback, porém contém launch/stop de processos e
  não tem lock, PID, lifecycle independente ou contrato de auth documentado.
- O bridge Herdr possui `FLOW_RUNNER_DIR` com default para o dotfiles e lê YAML
  de profiles diretamente.

## Decisões propostas

1. O serviço é o único escritor do state dir; CLI, web e TUI são clientes.
2. O bind padrão e único suportado nesta fase é `127.0.0.1`; não há flag para
   `0.0.0.0`. Exposição futura requer autenticação e threat model revisado.
3. Execução de agentes continua no host, por adapter explícito e autorização
   explícita do usuário. O serviço não inicia execução apenas por abrir web/TUI.
4. Docker entrega somente viewer/audit sobre um diretório de runs montado `:ro`.
5. A migração usa compatibilidade por wrapper/variáveis configuradas; move só
   ocorre após dependências semânticas estarem isoladas e testadas.
6. `flow-web` é observador opcional: não cria, inicia ou executa runs. Sua
   navegação suporta filtros por `flowId` e `runId` via query parameters.
7. O novo repo público contém código, schemas, MCP e exemplos sintéticos; não
   contém flows de empresas, nomes de clientes, processos internos, runs ou
   qualquer configuração de ambiente.
8. V1 é local-first: flows privados são arquivos locais opt-in. Registry e
   sincronização remota ficam fora desta change e exigem threat model e
   OpenSpec próprios antes de qualquer implementação.

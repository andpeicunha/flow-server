# Design: serviço local do flow-server

## Componentes e fronteiras

```text
                 máquina do desenvolvedor, autorização explícita
  Codex/Claude/Cursor ── runtime adapter ──┐
                                            │ (comandos no host)
  flow CLI ───────────── local HTTP ────────▼
  MCP local ────────────────────────────> flow-service
  flow-web (opcional) ─────────────────> flow-service
  flow-tui/Herdr (opcional) ────────────     │
                                              ▼
                                      flow-server-core
                               YAML/DAG · schemas · audit
                               receipts redigidos · state store
                                              │
                    FLOW_STATE_DIR (owner-only local filesystem)

  Docker viewer/audit ── mount runs:ro ──> leitura estática/audit, sem adapter,
                                            sem worktree, sem socket do host

  V2: registry privado ── OAuth/OIDC + sync explícito ──> cache local de flows
      (VPS/container)        nunca recebe worktree ou receipts por default
```

`flow-server-core` não conhece HTTP, Docker, Herdr, `$HOME`, paths do dotfiles
nem CLIs. Interfaces recebem dependências (filesystem, relógio, launcher e
redactor) e registram somente metadados observados. `flow-service` é o único
processo que escreve estados, events, PID e lock. O adapter faz a tradução para
uma CLI, mas não concede acesso que o usuário não autorizou ao iniciar o run.

O repositório público `flow-server` é separado do dotfiles e usa allowlist de
conteúdo: engine, schemas, CLI, serviço, MCP, adapters, Docker viewer/audit e
fixtures sintéticas. Ele nunca recebe a árvore atual de `flows/profiles`, nomes
de empresas/clientes, fluxos internos, configurações, sessões ou evidências.

## Inventário de acoplamentos acidentais

| Área atual | Evidência | Tratamento de migração |
| --- | --- | --- |
| Dotfiles/path | `opencode/bin/flow` fixa `$HOME/Apps/dotfiles/opencode/flow-runner` | Shim resolve o cliente instalado; path legado só é fallback temporário. |
| Estado e `$HOME` | `run-flow.ts` usa `homedir()` e `~/.local/state/flow-runs` | Resolver de state dir injetável e defaults por plataforma. |
| Profiles privados | loader aponta para `flows/profiles/<profile>` e skills do `$HOME` | Fontes externas allowlisted, sem varredura/cópia/empacotamento. Conteúdo não foi lido. |
| OpenCode | YAML legado contém `executor: opencode`; runner ainda aceita OpenCode | Compatibilidade de schema isolada; runtime do run é explícito. OpenCode não é default público. |
| CLIs de agentes | `run-flow.ts` constrói comandos Codex, Claude e OpenCode; Cursor ainda não tem adapter direto | Adapters separados, capability matrix e falha fechada; Cursor pode iniciar guided-only. |
| Viewer HTTP | `viewer.ts` conhece paths, profiles e mantém `activeChildren` para lançar/parar runs | Serviço passa a ser owner de lifecycle/state; web vira cliente. |
| Herdr | bridge usa `FLOW_RUNNER_DIR`, lê YAML e chama `flow` | `flow-tui` consome API; continua opcional e fora do core. |
| Instalação/documentação | Makefile, docs e Skill citam paths do dotfiles/OpenCode | Atualização só após shim e testes de instalação limpa. |

O inventário registra apenas contratos e paths de código. Não expõe nomes ou
conteúdo de profiles, nem sessões, secrets, logs reais ou credenciais.

## Flows privados: local-first e registry V2

Na V1, flow privado é um documento externo ao repo público, guardado em raiz
local explicitamente configurada e com permissões do usuário. O schema canônico
é JSON versionado (`flowDocument`); YAML continua aceito pelo loader como
formato de autoria e é normalizado localmente para esse schema. Isso evita uma
migração prematura dos YAMLs existentes e permite validação/revisionamento sem
expor conteúdo.

Na V2, `flow-registry` é um produto/serviço privado separado, potencialmente
hospedado em container na VPS escolhida depois de revisão operacional. Ele
armazena documentos por tenant e versão, com RBAC, auditoria de acesso,
criptografia em trânsito e em repouso, retenção/revogação e backup testado. O
usuário autentica no registry por OAuth/OIDC com Authorization Code + PKCE; o
token fica no cofre/credential store do SO, nunca em flow, receipt ou log. O
cliente sincroniza sob ação explícita e valida assinatura/hash/schema antes de
publicar uma cópia local. O registry não recebe workspace, prompts, output,
receipt, diff ou logs de run por default.

`flow-service` local permanece o executor/orquestrador. Rodar Docker para o
registry ou viewer não torna Docker executor de agentes. Um modo self-hosted
do registry pode ser documentado no V2, sempre sem Docker socket e sem montar
worktrees; o Docker da V1 continua restrito a viewer/audit read-only.

## MCP local

`flow-mcp` é instalado no harness do desenvolvedor e fala somente com
`flow-service` em loopback. Suas ferramentas planejadas são `flow_list`,
`flow_inspect`, `flow_start_guided`, `flow_next`, `flow_checkpoint`,
`flow_audit` e `flow_open`. `flow_start_guided` solicita confirmação local
antes de qualquer operação que possa iniciar adapter no host; nenhuma tool
aceita shell arbitrário, path de profile remoto ou token de registry. O MCP
expõe metadados/redações mínimas ao agente e não converte o harness em canal de
upload de evidências.

## Layout alvo (pós-migração)

```text
packages/
  flow-server-core/       engine, schemas, state/audit/redaction
  flow-service/           HTTP loopback, lifecycle, lock/PID
  flow-cli/               cliente HTTP e fallback compatível temporário
  runtime-adapters/       codex, claude, cursor
  flow-web/               viewer opcional
  flow-tui/               bridge Herdr opcional, pacote separado
examples/hello-flow/      flow, workspace fictício, receipts/audit sintéticos
docker/viewer-audit/      imagem sem executor e documentação read-only
```

Esse é um layout de destino, não autorização para criar ou mover diretórios
nesta change. O pacote publicado usa allowlist de arquivos públicos; profiles,
estado e exemplos gerados localmente ficam fora dessa allowlist.

## Estado e lifecycle

`FLOW_STATE_DIR` tem precedência explícita. Sem configuração, o serviço usa o
diretório de dados por usuário da plataforma (macOS: `~/Library/Application
Support/flow-server`; Linux: `$XDG_STATE_HOME/flow-server` ou
`~/.local/state/flow-server`; Windows: `%LOCALAPPDATA%\\flow-server`). A
implementação criará permissões privadas quando suportadas e nunca apagará o
diretório automaticamente.

Dentro dele: `runs/`, `service.lock`, `service.pid`, `service.json` e logs
redigidos. O lock contém identidade/processo/endpoint e é adquirido antes de
escutar a porta. Em lock ocupado, `start` consulta health do owner; PID morto
vira lock stale recuperável somente depois de validação de identidade. SIGINT,
SIGTERM e `flow-server stop` param novas ações, aguardam checkpoint atômico e
removem PID/lock apenas se forem do owner.

## Contrato HTTP v1 local

Base: `http://127.0.0.1:<porta>`, porta configurável e descoberta pelo arquivo
de serviço. Todo erro usa envelope `{ "error": { "code", "message" } }`.

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/v1/health` | versão, PID, bind loopback e estado do serviço |
| GET | `/v1/flows` | listar flows core e fontes externas explicitamente habilitadas |
| GET | `/v1/runs?flowId=&runId=` | listar resumos redigidos, com filtros opcionais |
| POST | `/v1/runs` | criar run; requer workspace, flow, modo e runtime explícitos |
| GET | `/v1/runs/{id}` | estado do run e nodes, redigidos |
| POST | `/v1/runs/{id}/checkpoint` | checkpoint validado e receipt normalizado |
| POST | `/v1/runs/{id}/lifecycle` | `pause`, `resume`, `stop`, com transições válidas |
| POST | `/v1/runs/{id}/audit` | gerar ou retornar auditoria determinística |
| GET | `/v1/runs/{id}/audit` | relatório e achados redigidos |
| POST | `/v1/service/shutdown` | shutdown limpo, somente loopback |

Não há endpoint de shell arbitrário, upload implícito, telemetria, nem API que
aceite profile path do request. A criação de run exige confirmação local no CLI
quando o modo pede adapter host; guided mode apenas cria o dossiê e retorna o
contrato de próxima etapa. Enquanto o bind é estritamente loopback, autenticação
não é necessária. A documentação deve declarar que proxy, túnel ou bind
externo são não suportados até existir autenticação, autorização por origem e
revisão de segurança.

## flow-web: observação e navegação direta

`flow-web` não cria run e não expõe controles de execução. A criação, escolha
de runtime e autorização ficam no CLI/API de lifecycle; o web apenas consulta
estado, receipts e auditorias redigidos. A página aceita `?flowId=<id>` para
filtrar todas as execuções de um flow lógico e `?runId=<id>` para selecionar
diretamente um dossiê. Se ambos existirem, `runId` determina a seleção e
`flowId` permanece como filtro de contexto. IDs inválidos mostram estado vazio
ou not-found sem criar/alterar run.

Essa distinção evita ambiguidade do comentário de design: um `flowId` pode ter
vários runs; somente `runId` identifica uma execução que o agente pode abrir
diretamente no viewer.

## Profiles, flows e runtimes

O pacote inclui flows core sanitizados e schemas. Fontes externas entram por
configuração local: uma lista de diretórios, `FLOW_PROFILE_DIR`/`FLOW_FLOW_DIR`
de compatibilidade e uma precedência documentada: core < flow externo < profile
explicitamente selecionado. Names são validados; paths são canonicalizados e
devem permanecer dentro de raiz autorizada. Nenhum profile é descoberto de
`$HOME` por varredura. Profiles não são servidos por HTTP nem incluídos no npm
tarball por padrão.

O run armazena `runtime` e `executionMode` explicitamente. Adapters Codex,
Claude e Cursor têm capability matrix e falham fechado quando a operação não é
suportada. Eles são processos do host; `flow-service` não transforma uma
requisição web em acesso irrestrito a um worktree.

## Docker viewer/audit

Imagem futura aceita somente `flow-viewer` e `flow-audit`, por exemplo:
`docker run --read-only --cap-drop=ALL -p 127.0.0.1:8080:8080 -v
"/abs/runs:/runs:ro" flow-server/viewer-audit`. Ela não contém adapters, Docker
socket, credenciais, profile loader ou endpoint de criar/controlar run. A UI
deve advertir que evidências podem conter dados sensíveis mesmo redigidas.

## Exemplo público

`examples/hello-flow` usará um workspace fictício, um DAG de dois nodes sem
runtime real, estado/receipts/audit sintéticos e um README com `npm install`,
`flow-server start`, `flow list`, `flow audit` em menos de cinco minutos.
Fixtures terão marcador de conteúdo sintético e um teste impedirá strings de
paths pessoais, tokens, e-mails ou names de profiles existentes.

## Migração e rollback

1. Extrair contratos e testes sem mover paths.
2. Introduzir core e state store atrás do runner atual.
3. Adicionar serviço/CLI e manter `opencode/bin/flow` como shim que delega ao
   novo cliente quando disponível, senão ao runner legado com aviso controlado.
4. Migrar flow-web e flow-tui para API; eliminar leitura direta de YAML/state.
5. Separar packages/publicação e só então mover diretórios.

Cada PR mantém o comando `flow`, schema e dossiês legados legíveis. Rollback é
por feature flag/seleção de backend do shim, sem converter ou apagar runs. A
remoção do shim requer uma release estável, janela de suporte publicada e uma
migração testada de state somente por cópia/backup.

## Compatibilidade

| Plataforma | Serviço/CLI | Estado | Adapters host | Docker viewer/audit |
| --- | --- | --- | --- | --- |
| macOS | suportado | Application Support; fallback documentado | Codex/Claude primeiro; Cursor após contrato | Docker Desktop, volume `:ro` |
| Linux/WSL | suportado | XDG state | detecta WSL; CLIs no ambiente explicitamente escolhido | Docker Engine/Desktop, loopback do ambiente |
| Windows | suportado | LocalAppData | PowerShell/process lifecycle; Cursor após homologação | Docker Desktop; paths convertidos/documentados |

Em todas as plataformas, bind permanece `127.0.0.1`, lock é por sistema de
arquivos e shutdown precisa de testes de sinal/controle equivalentes.

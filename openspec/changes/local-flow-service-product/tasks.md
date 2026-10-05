# Tasks

## PR 0 — preparação para primeira release pública, sem conteúdo privado

- [ ] Escolher licença, adicionar políticas de contribuição e configurar allowlist de publicação antes da primeira release pública.
- [ ] Configurar CI para bloquear names de empresas, paths pessoais, secrets, profiles, runs e fixtures não sintéticas.
- [ ] Verificar: inspeção manual e secret scan do repositório/tarball não encontram conteúdo do dotfiles.

## PR 1 — contratos e fixtures sem mover código

- [x] Criar schemas versionados de flow, run, receipt e API com fixtures públicas.
- [x] Definir para a API os bodies de request/response, códigos HTTP, paginação, estados/modos/runtimes, transições e idempotência.
- [ ] Extrair testes de contrato para DAG, checkpoint, redaction e audit do runner atual.
- [ ] Adicionar teste de allowlist/secret scan do futuro artefato e criar `examples/hello-flow` sintético.
- [ ] Verificar: 50 testes atuais continuam verdes; fixtures não contêm paths, profiles ou dados pessoais.

## PR 2 — core e estado injetável

- [ ] Isolar `flow-server-core` atrás de interfaces de filesystem, state dir, relógio e redactor, sem move físico.
- [ ] Implementar resolução de state dir macOS/Linux/WSL/Windows e lock/PID atômico testável.
- [ ] Manter leitura de dossiês legados; não migrar nem apagar runs automaticamente.
- [ ] Verificar: testes de compatibilidade de run/receipt/audit e casos lock/stale/shutdown.

## PR 3 — serviço local e API mínima

- [x] Implementar `flow-service` loopback com `/v1/health`, runs, checkpoint, audit e lifecycle.
- [x] Remover do endpoint qualquer shell arbitrário e proteger mutações por transições de estado.
- [x] Documentar ausência de telemetria e a restrição de bind/autenticação.
- [x] Verificar: integração HTTP, bind rejeitado fora de loopback, single-instance e SIGINT/SIGTERM.

## PR 4 — CLI e shim compatível

- [x] Implementar `flow-server start|status|stop|doctor` e cliente `flow` para a API.
- [ ] Publicar `flow` independente no produto. Manter, no dotfiles, um shim opt-in e testado separadamente para usuários do runner legado.
- [ ] Exigir runtime/mode explícitos e confirmação do usuário para adapter host.
- [ ] Verificar: scripts legados e novos em macOS/Linux/WSL/Windows; nenhuma mudança de path obrigatória.

## PR 5 — profiles e runtime adapters

- [x] Implementar fontes externas allowlisted e precedência documentada; remover descoberta implícita de `$HOME`.
- [x] Separar adapters Codex/Claude e publicar matriz de capacidades; runtime não suportado falha fechado.
- [x] Verificar: instalação limpa não vê profiles e adapter sem runtime falha fechado.

## PR 6 — clientes opcionais, MCP V1 e Docker read-only

- [ ] Migrar flow-web e flow-tui para API, preservando Herdr como dependência opcional.
- [ ] Implementar `flow-mcp` local contra loopback, com allowlist de tools e confirmação para operações host-side.
- [ ] Remover da flow-web toda criação/início de run e adicionar `flowId`/`runId` como filtros query-string documentados e testados.
- [ ] Criar Docker viewer/audit read-only, sem adapters, worktree ou Docker socket.
- [ ] Verificar: imagem não escreve volume, não contém secrets/profiles e funciona com fixture pública.

## V2 posterior — registry privado (change e threat model próprios antes de implementar)

- [ ] Criar uma OpenSpec separada para `flow-registry`, com tenant model, RBAC, OAuth/OIDC+PKCE, revogação, auditoria, retenção, backup e incident response.
- [ ] Definir deploy privado em VPS somente após revisão de isolamento, secrets, banco, TLS, observabilidade e recovery; não reutilizar o Docker viewer como executor.
- [ ] Verificar: tenant não lê flow de outro tenant; registry não recebe worktree/receipt por default; token não aparece em logs, flows, cache ou MCP payloads.

## PR 7 — primeira release e retirada controlada da compatibilidade

- [ ] Preparar pacotes, licença, README, threat model, SBOM/dependency review e release checklist.
- [ ] Homologar matriz de plataformas/runtimes e executar secret scan/artefato allowlist em CI.
- [ ] Após janela publicada, tornar shim legado opt-in antes de removê-lo em release major.

## Checklist de release

- [ ] Licença e avisos de third-party claros.
- [ ] README, quickstart e exemplo sintético verificados.
- [ ] Threat model revisado: loopback, profiles, receipts, adapters e Docker.
- [ ] Secret scan em source, fixtures, tarball e imagem.
- [ ] Unit, integração, compatibilidade, lifecycle e redaction verdes.
- [ ] Teste de instalação limpa em macOS, Linux/WSL e Windows.
- [ ] Nenhuma telemetria/upload; declaração de privacidade e suporte de segurança.

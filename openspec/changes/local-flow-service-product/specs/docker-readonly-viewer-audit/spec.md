## ADDED Requirements

### Requirement: Docker somente leitor
A imagem Docker SHALL oferecer apenas viewer/audit de evidências em `/runs`
montado read-only; ela SHALL não executar agents nem acessar worktrees ou socket
Docker do host.

#### Scenario: Auditoria em volume de runs
- **WHEN** o usuário monta uma pasta de runs em `/runs:ro`
- **THEN** o container gera/mostra auditoria sem criar ou modificar arquivos no volume

### Requirement: Executor Docker fora de escopo
O produto SHALL não documentar nem aceitar um modo Docker que crie run, lance
runtime adapter, monte worktree gravável ou use credenciais do host nesta change.

#### Scenario: Tentativa de execução pelo container
- **WHEN** o usuário tenta usar a imagem para criar run ou iniciar adapter
- **THEN** a imagem não oferece esse comando, endpoint, adapter, worktree ou
  credencial do host

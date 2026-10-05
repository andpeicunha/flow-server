## ADDED Requirements

### Requirement: Serviço local seguro
O produto SHALL iniciar `flow-service` somente em `127.0.0.1` por padrão e NÃO
SHALL oferecer `0.0.0.0` nesta fase.

#### Scenario: Serviço inicia normalmente
- **WHEN** o usuário executa `flow-server start`
- **THEN** um único processo adquire lock, grava PID/metadados redigidos e expõe `/v1/health` apenas em loopback

#### Scenario: Segunda instância é solicitada
- **WHEN** outro `start` encontra lock de owner saudável
- **THEN** o comando retorna o endpoint/estado existente e não inicia outro processo

### Requirement: Estado local configurável e proprietário
O serviço SHALL usar `FLOW_STATE_DIR` quando definido ou um default seguro por
plataforma, e SHALL ser o único escritor de runs, receipts, events e auditorias.

#### Scenario: Diretório configurado
- **WHEN** `FLOW_STATE_DIR` aponta para diretório acessível do usuário
- **THEN** todos os artefatos de serviço e runs são criados ali sem depender do dotfiles

### Requirement: Lifecycle limpo
O serviço SHALL suportar health, status, shutdown e recuperação segura de lock
stale, sem apagar runs existentes.

#### Scenario: Stop solicitado
- **WHEN** `flow-server stop` solicita shutdown de owner local
- **THEN** o serviço impede novas mutações, conclui checkpoint seguro, encerra e remove apenas seu PID/lock

### Requirement: Privacidade e redaction
O serviço SHALL não enviar telemetria, artefatos ou logs implicitamente e SHALL
aplicar redaction antes de persistir ou retornar receipts/logs pela API.

#### Scenario: Receipt contém segredo reconhecível
- **WHEN** checkpoint recebe campo credential-shaped ou token reconhecível
- **THEN** o valor redigido é persistido e retornado sem upload externo

#### Scenario: Conteúdo sensível recebido
- **WHEN** receipt ou log contém valor identificado como sensível
- **THEN** o serviço grava e retorna `[REDACTED]`, nunca o valor original; os
  demais metadados do receipt continuam disponíveis para auditoria local

### Requirement: Segurança de exposição futura
O serviço SHALL exigir token local nas rotas mutáveis, mesmo em loopback, e a
documentação SHALL declarar que exposição de porta é não suportada nesta fase.

#### Scenario: Requisição mutável sem token local
- **WHEN** uma chamada cria, checkpointa, altera lifecycle ou desliga o serviço
  sem o token local válido
- **THEN** o serviço a rejeita sem alterar state ou iniciar adapter

#### Scenario: Tentativa de bind externo
- **WHEN** o usuário tenta iniciar o serviço fora de `127.0.0.1`
- **THEN** o comando falha e informa que esse modo não é suportado na V1

## ADDED Requirements

### Requirement: CLI como cliente local
`flow-server` SHALL oferecer `start`, `status`, `stop` e `doctor`; `flow` SHALL
oferecer listagem, início, inspeção, checkpoint e auditoria via API local.

#### Scenario: Serviço indisponível
- **WHEN** um comando de cliente é chamado sem serviço ativo
- **THEN** a CLI informa ação segura para iniciar o serviço e não inicia runtime ou Docker implicitamente

### Requirement: Runtime e autorização explícitos
A criação de run SHALL exigir runtime e modo de execução explícitos quando há
adapter host; a CLI SHALL mostrar workspace/runtime/mode antes de solicitar a
autorização aplicável.

#### Scenario: Pedido sem runtime
- **WHEN** o usuário pede execução direta sem runtime
- **THEN** a CLI falha fechada e não seleciona Codex, Claude ou Cursor por default

### Requirement: Compatibilidade temporária
O comando `flow` existente SHALL continuar aceitando os subcomandos legados
durante a transição, por shim configurável e aviso de depreciação não intrusivo.

#### Scenario: Nova instalação ainda aponta ao wrapper legado
- **WHEN** o serviço novo ainda não foi instalado ou habilitado
- **THEN** o wrapper preserva o comportamento legado sem mover paths ou perder runs


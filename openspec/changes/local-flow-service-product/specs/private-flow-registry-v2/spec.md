## ADDED Requirements

### Requirement: Limite entre repo público e flows privados
O repositório público SHALL conter somente código, schemas, MCP e exemplos
sintéticos. Flows de empresas, clientes ou processos internos SHALL permanecer
fora do repositório e do artefato público.

#### Scenario: Publicação do pacote
- **WHEN** CI prepara tarball, imagem ou release pública
- **THEN** allowlist e secret scan bloqueiam profiles, flows privados, nomes de organizações, paths pessoais, runs, receipts e credenciais

### Requirement: Registry privado futuro com isolamento de tenant
Em V2, `flow-registry` SHALL ser um serviço privado separado que distribui
documentos de flow versionados por tenant e não executa agentes.

#### Scenario: Usuário autenticado sincroniza flows
- **WHEN** usuário autenticado por OAuth/OIDC com PKCE solicita sync explícito
- **THEN** recebe somente versões autorizadas de seu tenant, validadas por schema e hash antes do cache local

#### Scenario: Evidência de run local
- **WHEN** o usuário executa ou audita um flow local
- **THEN** workspace, prompt, output, receipt, diff e log não são enviados ao registry por default

### Requirement: Formato externo e compatível
O registry SHALL armazenar documento `flowDocument` JSON versionado. O cliente
SHALL continuar aceitando YAML local e normalizá-lo para o mesmo schema.

#### Scenario: Flow YAML legado local
- **WHEN** um usuário configura uma raiz local com YAML válido
- **THEN** o serviço normaliza e valida o flow sem enviá-lo ao registry


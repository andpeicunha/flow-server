## ADDED Requirements

### Requirement: MCP local mediado pelo serviço
O produto SHALL oferecer `flow-mcp` como bridge local opcional para harnesses
de agentes. O MCP SHALL conectar somente ao `flow-service` em loopback.

#### Scenario: Harness lista flows disponíveis
- **WHEN** o harness chama `flow_list` pelo MCP local
- **THEN** recebe apenas metadados/redações permitidos pelo serviço local e nenhum dado é enviado a um serviço remoto

### Requirement: Ferramentas MCP limitadas e autorizadas
O MCP SHALL expor apenas ferramentas versionadas de listar, inspecionar,
iniciar modo guiado, avançar, checkpointar, auditar e abrir viewer. Ele SHALL
NOT expor shell arbitrário, path remoto de profile, token de registry ou acesso
direto ao filesystem de runs.

#### Scenario: Operação com adapter host
- **WHEN** uma tool pede operação que iniciaria runtime adapter no host
- **THEN** o serviço/CLI exige a confirmação local aplicável antes de iniciar o processo


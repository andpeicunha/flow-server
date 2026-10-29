## ADDED Requirements

### Requirement: Flow sources are explicit and local / Fontes de flow são explícitas e locais

**[us]** `flow-server` SHALL load personal flows only from configured canonical
local directories. It SHALL NOT search `$HOME`, infer a repository, contact a
remote service, or read outside a configured source root.

**[pt]** O `flow-server` SHALL carregar flows pessoais somente de diretórios
locais canônicos configurados. Ele SHALL NOT procurar no `$HOME`, inferir um
repositório, contatar serviço remoto ou ler fora da raiz configurada.

#### Scenario: No source is configured / Nenhuma fonte está configurada

**[us]**

- **WHEN** `flow-server` starts without a configured personal source
- **THEN** it exposes only bundled starter metadata and does not search the filesystem

**[pt]**

- **WHEN** o `flow-server` inicia sem uma fonte pessoal configurada
- **THEN** ele expõe somente metadados iniciais empacotados e não procura no filesystem

#### Scenario: A flow escapes its source root / Um flow escapa da raiz da fonte

**[us]**

- **WHEN** a configured entry resolves through a symlink outside its source root
- **THEN** `flow-server` rejects the entry and does not read the target

**[pt]**

- **WHEN** uma entrada configurada resolve por symlink para fora da raiz da fonte
- **THEN** o `flow-server` rejeita a entrada e não lê o destino

### Requirement: Local and Git modes share the same execution boundary / Modos local e Git compartilham o mesmo limite de execução

**[us]** A source SHALL use `local` or `git` mode. Both modes SHALL resolve to a
local directory before flow discovery. Git mode SHALL NOT be required for
execution and SHALL NOT grant `flow-server` access to Git credentials.

**[pt]** Uma fonte SHALL usar modo `local` ou `git`. Ambos SHALL resolver para
um diretório local antes da descoberta de flows. O modo Git SHALL NOT ser
necessário para execução e SHALL NOT dar ao `flow-server` acesso a credenciais Git.

#### Scenario: Git provider is unavailable / Provedor Git está indisponível

**[us]**

- **WHEN** a valid Git worktree is present but its remote provider is unavailable
- **THEN** `flow-server` can validate and execute the local flow without network access

**[pt]**

- **WHEN** uma worktree Git válida existe, mas o provedor remoto está indisponível
- **THEN** o `flow-server` valida e executa o flow local sem acesso de rede

### Requirement: YAML is parsed through a restricted profile / YAML passa por perfil restrito

**[us]** The loader SHALL accept YAML authoring without custom tags, executable
types, merge keys, duplicate keys, aliases, or cyclic references. It SHALL
enforce documented size and nesting limits before canonicalization.

**[pt]** O loader SHALL aceitar autoria YAML sem tags customizadas, tipos
executáveis, merge keys, chaves duplicadas, aliases ou referências cíclicas. Ele
SHALL aplicar limites documentados de tamanho e profundidade antes da
canonicalização.

#### Scenario: YAML uses an unsafe feature / YAML usa recurso inseguro

**[us]**

- **WHEN** a flow document contains a custom tag, alias, duplicate key, or exceeds a resource limit
- **THEN** validation fails closed and the flow is not listed or executed

**[pt]**

- **WHEN** um flow contém tag customizada, alias, chave duplicada ou excede um limite
- **THEN** a validação falha fechada e o flow não é listado nem executado

### Requirement: Valid flows have deterministic canonical identity / Flows válidos têm identidade canônica determinística

**[us]** YAML and JSON inputs SHALL pass through the same versioned schema and
canonicalization. Equivalent valid definitions SHALL produce the same canonical
content hash. Unknown fields, invalid dependencies, unsupported runtimes,
models, or effort values SHALL fail closed.

**[pt]** Entradas YAML e JSON SHALL passar pelo mesmo schema versionado e pela
mesma canonicalização. Definições válidas equivalentes SHALL produzir o mesmo
hash canônico. Campos desconhecidos, dependências inválidas, runtimes, modelos ou
valores de effort não suportados SHALL falhar fechados.

#### Scenario: YAML and JSON describe the same flow / YAML e JSON descrevem o mesmo flow

**[us]**

- **WHEN** equivalent YAML and JSON documents pass validation
- **THEN** they produce the same canonical model and content hash

**[pt]**

- **WHEN** documentos YAML e JSON equivalentes passam na validação
- **THEN** eles produzem o mesmo modelo canônico e hash de conteúdo

### Requirement: Active runs keep their selected flow identity / Runs ativas mantêm a identidade do flow selecionado

**[us]** A run SHALL record source ID, canonical content hash, and optional Git
commit when it starts. A source update SHALL NOT change the definition selected
by an active run.

**[pt]** Uma run SHALL registrar ID da fonte, hash canônico e commit Git opcional
ao iniciar. Uma atualização da fonte SHALL NOT mudar a definição selecionada por
uma run ativa.

#### Scenario: Source changes during a run / Fonte muda durante uma run

**[us]**

- **WHEN** a flow file changes after a run has started
- **THEN** the active run continues with its recorded definition and identity

**[pt]**

- **WHEN** um arquivo de flow muda depois que uma run iniciou
- **THEN** a run ativa continua com sua definição e identidade registradas

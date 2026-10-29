# Design: local flow sources and Herdr distribution / Design: fontes locais de flows e distribuição pelo Herdr

## Architecture / Arquitetura

**[us]**

```text
Herdr plugin installation
  -> installs plugin UI, flow-server, CLI, schemas, Skills, instructions, examples
  -> first-use onboarding chooses one source mode

local mode: flow-server -> explicitly configured local flow directory
git mode:   flow-server -> explicitly configured local Git worktree
                              ^
                              |
                    developer's agent uses Git
```

All execution remains local. Git is an optional storage, history, and
synchronization layer. `flow-server` reads the configured local worktree and
does not need GitHub, a VPS, or the remote MCP to execute a flow.

**[pt]**

```text
Instalação do plugin do Herdr
  -> instala UI, flow-server, CLI, schemas, Skills, instruções e exemplos
  -> onboarding do primeiro uso escolhe um modo de fonte

modo local: flow-server -> diretório local de flows configurado explicitamente
modo git:   flow-server -> worktree Git local configurada explicitamente
                              ^
                              |
                    agente do desenvolvedor usa Git
```

Toda execução continua local. Git é uma camada opcional de armazenamento,
histórico e sincronização. O `flow-server` lê a worktree local configurada e não
precisa de GitHub, VPS ou MCP remoto para executar um flow.

## Installation and first use / Instalação e primeiro uso

**[us]**

`herdr plugin install` remains the only public installation entrypoint. The
build/install step stays non-interactive so package installation cannot hang.
The first plugin launch opens an onboarding screen when no source configuration
exists.

The onboarding screen offers:

1. `local`: choose or create a local directory.
2. `git`: choose an existing local worktree or provide a repository URL and a
   local destination for the developer's agent to clone.

The plugin writes only non-secret source metadata. It never asks for or stores
Git credentials. A clone or other Git mutation is shown as an agent task with
the exact target and requires the normal agent approval policy.

**[pt]**

`herdr plugin install` continua sendo o único ponto público de instalação. A
etapa de build/install permanece não interativa para que a instalação do pacote
não fique bloqueada. A primeira abertura do plugin mostra uma tela de onboarding
quando não existe configuração de fonte.

A tela de onboarding oferece:

1. `local`: escolher ou criar um diretório local.
2. `git`: escolher uma worktree local existente ou informar URL do repositório e
   destino local para o agente do desenvolvedor fazer o clone.

O plugin grava somente metadados não secretos da fonte. Ele nunca pede ou
armazena credenciais Git. Um clone ou outra mutação Git é exibido como tarefa
para o agente com o destino exato e segue a política normal de aprovação do
agente.

## Installed content and ownership / Conteúdo instalado e ownership

**[us]**

The plugin package owns versioned binaries, schemas, default Skills, agent
instructions, and immutable starter examples. Personal flow content belongs to
the developer and lives outside the plugin installation directory. Plugin
updates replace only plugin-owned files.

Starter examples are copied to a personal source only through an explicit
import action. Import never replaces a file with the same ID or path. Installed
agent instructions describe source boundaries, validation, safe Git behavior,
and the configured synchronization policy without embedding repository
credentials or private URLs in public artifacts.

**[pt]**

O pacote do plugin é dono dos binários versionados, schemas, Skills padrão,
instruções do agente e exemplos iniciais imutáveis. Conteúdo pessoal de flows
pertence ao desenvolvedor e fica fora do diretório de instalação do plugin.
Atualizações do plugin substituem somente arquivos do próprio plugin.

Exemplos iniciais são copiados para uma fonte pessoal apenas por uma ação
explícita de importação. A importação nunca substitui um arquivo com o mesmo ID
ou path. As instruções instaladas do agente descrevem limites das fontes,
validação, comportamento Git seguro e a política de sincronização configurada,
sem incluir credenciais de repositório ou URLs privadas em artefatos públicos.

## Source configuration / Configuração de fonte

**[us]**

The configuration stores a source ID, mode, canonical local path, optional
remote name, optional branch, and synchronization policies. The path must be
explicit, canonical, and outside the plugin-owned installation directory.
`flow-server` never searches `$HOME` for flows.

Example:

```yaml
sources:
  - id: personal
    mode: git
    path: /home/user/flows
    remote: origin
    branch: main
    sync:
      pull: confirm
      push: after-validation
```

The configuration stores no token, password, private key, credential-helper
output, or embedded authenticated URL.

**[pt]**

A configuração armazena ID da fonte, modo, path local canônico, remote opcional,
branch opcional e políticas de sincronização. O path deve ser explícito, canônico
e ficar fora do diretório de instalação do plugin. O `flow-server` nunca procura
flows no `$HOME`.

Exemplo:

```yaml
sources:
  - id: personal
    mode: git
    path: /home/user/flows
    remote: origin
    branch: main
    sync:
      pull: confirm
      push: after-validation
```

A configuração não armazena token, senha, chave privada, saída de credential
helper ou URL autenticada embutida.

## YAML authoring and canonical model / Autoria YAML e modelo canônico

**[us]**

YAML is the source-of-truth authoring format. The parser uses a restricted YAML
subset: no custom tags, executable types, merge keys, duplicate keys, aliases,
or cyclic references. Documents have bounded byte size, nesting depth, scalar
length, and collection length.

After parsing, the document is validated against the versioned flow schema.
Unknown fields fail closed. IDs, dependencies, DAG shape, node contracts,
runtime names, model settings, and effort values are validated before the flow
is listed or executed. The validated object is normalized into a deterministic
canonical model used for hashing, caching, receipts, and execution.

JSON remains accepted as a compatibility input during migration and passes
through the same schema and canonicalization. Generated canonical JSON is an
internal cache artifact, not a second user-edited source file.

**[pt]**

YAML é o formato source of truth para autoria. O parser usa um subconjunto
restrito de YAML: sem tags customizadas, tipos executáveis, merge keys, chaves
duplicadas, aliases ou referências cíclicas. Documentos possuem limites de bytes,
profundidade, tamanho de valores escalares e tamanho de coleções.

Depois do parsing, o documento é validado contra o schema versionado de flow.
Campos desconhecidos falham fechados. IDs, dependências, formato do DAG,
contratos de nodes, nomes de runtimes, configurações de modelo e valores de
effort são validados antes de o flow ser listado ou executado. O objeto validado
é normalizado em um modelo canônico determinístico usado para hash, cache,
receipts e execução.

JSON continua aceito como entrada de compatibilidade durante a migração e passa
pelo mesmo schema e canonicalização. JSON canônico gerado é um artefato interno
de cache, não um segundo arquivo editado pelo usuário.

## Agent-managed Git synchronization / Sincronização Git administrada pelo agente

**[us]**

The plugin and `flow-server` expose source status and validation results. The
installed Skill tells the developer's agent how to use normal Git commands.
The product does not proxy Git or handle credentials.

After a flow file changes, a local hook marks the source as having pending flow
changes. It does not commit, pull, or push. Before a Git write, the agent must:

1. Resolve the configured source and confirm it is the intended worktree.
2. Show status and inspect the flow-only diff.
3. Validate every changed flow.
4. Refuse automatic sync when unrelated changes, conflicts, detached HEAD, an
   unexpected remote, or validation failures exist.
5. Stage only intended flow files and related approved metadata.
6. Follow the configured push policy.

Push policies are `manual`, `confirm`, and `after-validation`. `manual` is the
default. `after-validation` is explicit standing authorization for the agent to
commit and push only the validated flow change. It is not authorization to
rewrite history, force-push, create or delete repositories, change remotes, or
include unrelated files.

Pull policy is `confirm`. The agent must show the available change and receive
confirmation before it pulls or activates remote instructions. Automatic pull
is outside this change.

**[pt]**

O plugin e o `flow-server` expõem status da fonte e resultados de validação. A
Skill instalada explica ao agente do desenvolvedor como usar comandos Git
normais. O produto não intermedeia Git nem administra credenciais.

Depois que um arquivo de flow muda, um hook local marca a fonte como tendo
alterações pendentes. Ele não faz commit, pull ou push. Antes de uma escrita Git,
o agente deve:

1. Resolver a fonte configurada e confirmar que é a worktree pretendida.
2. Mostrar status e inspecionar o diff somente dos flows.
3. Validar todos os flows alterados.
4. Recusar sync automático quando houver mudanças não relacionadas, conflitos,
   detached HEAD, remote inesperado ou falha de validação.
5. Adicionar ao stage somente os arquivos de flow pretendidos e metadados
   relacionados aprovados.
6. Seguir a política de push configurada.

As políticas de push são `manual`, `confirm` e `after-validation`. `manual` é o
padrão. `after-validation` é autorização permanente e explícita para o agente
fazer commit e push somente da alteração validada do flow. Não é autorização
para reescrever histórico, fazer force-push, criar ou excluir repositórios,
alterar remotes ou incluir arquivos não relacionados.

A política de pull é `confirm`. O agente deve mostrar a alteração disponível e
receber confirmação antes de fazer pull ou ativar instruções remotas. Pull
automático está fora desta change.

## Update and rollback / Atualização e rollback

**[us]**

Plugin updates and personal flow synchronization share one Herdr surface but
remain separate operations. Updating the plugin changes only plugin-owned
artifacts. Synchronizing a Git source changes only the user-owned worktree.

Every run records the canonical content hash and, when available, the Git
commit for each selected flow. A developer can inspect that identity later.
Rollback uses normal Git history in `git` mode or a local versioned backup in
`local` mode. The runner never silently changes the flow of an active run.

**[pt]**

Atualizações do plugin e sincronização de flows pessoais compartilham uma única
superfície no Herdr, mas continuam sendo operações separadas. Atualizar o plugin
muda somente artefatos do plugin. Sincronizar uma fonte Git muda somente a
worktree do usuário.

Cada run registra o hash canônico e, quando disponível, o commit Git de cada flow
selecionado. O desenvolvedor pode consultar essa identidade depois. Rollback usa
o histórico Git normal no modo `git` ou backup local versionado no modo `local`.
O runner nunca muda silenciosamente o flow de uma run ativa.

## Repository boundaries / Limites de repositório

**[us]**

- `flow-server` owns source configuration contracts, restricted YAML parsing,
  schema validation, canonicalization, source status, flow identity, and local
  execution boundaries.
- `flow-tui` owns installation integration, first-use onboarding, source setup
  UI, pending-change display, and agent-task handoff.
- Installed Skills and instructions own the agent procedure for Git operations.
- The user's Git provider and local Git client own authentication and transport.

**[pt]**

- `flow-server` é dono dos contratos de configuração de fonte, parsing YAML
  restrito, validação de schema, canonicalização, status da fonte, identidade do
  flow e limites de execução local.
- `flow-tui` é dono da integração de instalação, onboarding do primeiro uso, UI
  de configuração da fonte, exibição de mudanças pendentes e handoff para tarefa
  do agente.
- Skills e instruções instaladas são donas do procedimento do agente para
  operações Git.
- O provedor Git do usuário e o cliente Git local são donos da autenticação e
  transporte.

## Migration / Migração

**[us]**

Existing explicit JSON directories remain valid. The migration adds YAML and
source configuration without searching for or moving existing content. Legacy
Herdr flow directories may be registered explicitly. A later migration tool
may convert JSON to YAML, but conversion is not required to execute existing
flows.

The current remote MCP implementation remains in the repository but is not
installed, contacted, or required by this local product path. VPS deployment
work is paused and can resume under a separate future change.

**[pt]**

Diretórios JSON explícitos existentes continuam válidos. A migração adiciona
YAML e configuração de fontes sem procurar ou mover conteýo existente.
Diretórios legados de flows do Herdr podem ser registrados explicitamente. Uma
tool futura pode converter JSON para YAML, mas a conversão não é necessária para
executar flows existentes.

A implementação atual do MCP remoto continua no repositório, mas não é instalada,
contatada ou exigida por este caminho local do produto. O trabalho de deploy na
VPS fica pausado e pode voltar em uma change futura separada.

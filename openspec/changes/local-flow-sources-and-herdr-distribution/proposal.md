# Local flow sources and Herdr distribution / Fontes locais de flows e distribuição pelo Herdr

## Why / Por quê

**[us]**

Developers need to install and use `flow-server` without sending private flow
definitions, prompts, workspace data, or run evidence to infrastructure owned
by this project. A local-first source model lets each developer keep flows only
on the machine or in a Git repository that the developer owns and controls.
The Herdr plugin provides one installation and onboarding entrypoint, while the
developer's agent follows installed Skills and instructions to validate and
optionally synchronize flow changes.

**[pt]**

Desenvolvedores precisam instalar e usar o `flow-server` sem enviar definições
privadas de flows, prompts, dados do workspace ou evidências de runs para uma
infraestrutura deste projeto. Um modelo local-first permite que cada
desenvolvedor mantenha os flows somente na máquina ou em um repositório Git que
ele possui e controla. O plugin do Herdr fornece um único ponto de instalação e
onboarding, enquanto o agente do desenvolvedor segue Skills e instruções
instaladas para validar e, opcionalmente, sincronizar alterações dos flows.

## What changes / O que muda

**[us]**

- Make the Herdr plugin the installation entrypoint for the plugin UI,
  `flow-server`, local CLI, schemas, agent Skills, instructions, and starter
  flows.
- Add first-use onboarding with `local` and `git` source modes.
- Load flows only from explicitly configured local directories. In `git` mode,
  the configured directory is a normal user-owned Git worktree.
- Use YAML as the human and agent authoring format, then parse and validate it
  into a deterministic canonical model before execution.
- Install an agent workflow for status, validation, diff review, commit, and
  optional push. The agent uses the developer's existing Git and SSH setup.
- Add explicit synchronization policies. Remote pulls require confirmation by
  default. Pushes may be manual, confirmed, or allowed after successful flow
  validation.
- Keep official starter flows separate from personal flows and never overwrite
  personal content during plugin updates.
- Pause the VPS and remote MCP path. A shared remote catalog remains a possible
  future team feature and is not required by this change.

**[pt]**

- Tornar o plugin do Herdr o ponto de instalação da UI do plugin,
  `flow-server`, CLI local, schemas, Skills do agente, instruções e flows
  iniciais.
- Adicionar onboarding no primeiro uso com modos de fonte `local` e `git`.
- Carregar flows somente de diretórios locais configurados explicitamente. No
  modo `git`, o diretório configurado é uma worktree Git comum controlada pelo
  usuário.
- Usar YAML como formato de autoria para pessoas e agentes, convertendo e
  validando o conteúdo em um modelo canônico determinístico antes da execução.
- Instalar um workflow para o agente executar status, validação, revisão de
  diff, commit e push opcional. O agente usa a configuração Git e SSH existente
  do desenvolvedor.
- Adicionar políticas explícitas de sincronização. Pull remoto exige confirmação
  por padrão. Push pode ser manual, confirmado ou permitido após validação do
  flow.
- Manter flows iniciais oficiais separados dos flows pessoais e nunca
  sobrescrever conteúdo pessoal durante atualizações do plugin.
- Pausar o caminho de VPS e MCP remoto. Um catálogo remoto compartilhado continua
  sendo uma possibilidade futura para equipes e não é exigido por esta change.

## Non-goals / Fora de escopo

**[us]**

- Host flows, run evidence, prompts, or workspace data in project-owned cloud
  infrastructure.
- Configure or repair the current VPS, Caddy, Cloudflare, WorkOS, or remote MCP
  deployment.
- Store, request, proxy, or manage GitHub tokens, SSH keys, passwords, or Git
  credentials.
- Push a flow before validation or without the configured user policy.
- Pull and activate remote flow changes without user confirmation.
- Merge conflicting Git changes automatically.
- Overwrite personal flows, repositories, agent instructions, or local edits
  during a plugin update.
- Make the Herdr UI, the local MCP, or `flow-server` a general-purpose Git
  credential or repository manager.

**[pt]**

- Hospedar flows, evidências de runs, prompts ou dados de workspace em
  infraestrutura cloud deste projeto.
- Configurar ou corrigir a VPS atual, Caddy, Cloudflare, WorkOS ou deploy do MCP
  remoto.
- Armazenar, pedir, intermediar ou administrar tokens do GitHub, chaves SSH,
  senhas ou credenciais Git.
- Enviar um flow antes da validação ou sem a política configurada pelo usuário.
- Fazer pull e ativar alterações remotas de flows sem confirmação do usuário.
- Resolver conflitos Git automaticamente.
- Sobrescrever flows pessoais, repositórios, instruções do agente ou edições
  locais durante uma atualização do plugin.
- Transformar a UI do Herdr, o MCP local ou o `flow-server` em gerenciador geral
  de credenciais Git ou repositórios.

## Impact / Impacto

**[us]**

This change affects `flow-server` source discovery and validation, the Herdr
plugin installer and first-use UI, the local agent instruction package, and the
contract between a completed flow edit and optional Git synchronization. It
reuses the current explicit-directory trust boundary and extends it with safe
YAML parsing. Existing JSON flow loading remains compatible during migration.

**[pt]**

Esta change afeta a descoberta e validação de fontes no `flow-server`, o
instalador e a UI de primeiro uso do plugin do Herdr, o pacote local de
instruções do agente e o contrato entre uma edição concluída de flow e sua
sincronização Git opcional. Ela reutiliza o limite de confiança atual baseado em
diretórios explícitos e o estende com parsing seguro de YAML. O carregamento de
flows JSON existente continua compatível durante a migração.

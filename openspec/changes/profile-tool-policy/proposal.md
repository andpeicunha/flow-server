# Profile tool policy / Política de ferramentas por perfil

## Why / Por quê

**[us]** A flow can declare a Skill from another organization's agent catalog. The
current source validation does not reject it, and `doctor` contains a fixed
Skill-to-MCP check for one private profile. This can block an unrelated run or
apply the wrong project's rules.

**[pt]** Um flow pode declarar uma Skill de outra organização presente no catálogo
global do agente. A validação atual da fonte não a rejeita, e o `doctor` contém
uma associação fixa entre Skill e MCP de um perfil privado. Isso pode bloquear
uma run alheia ou aplicar regras do projeto errado.

## What changes / O que muda

**[us]** Add an optional `policy` to each configured source (the local profile).
It has simple allow and deny patterns for Skill IDs and MCP names. `*` grants
broad access explicitly; `!` denies a matching pattern and takes precedence.
A flow node declares which Skills and MCPs it uses. Validate the policy and
each node during plugin setup, source validation, and before a new run. Report
the profile, flow, node, and offending tool on failure. Make `doctor` check
only MCPs used by the selected flow's nodes for the primary and configured
fallback runtime. Remove private Skill and MCP names from generic service
code. Document the rule for agents on every installation.

**[pt]** Adicionar uma `policy` opcional a cada fonte configurada (o perfil local).
Ela contém padrões simples de permissão e negação para Skills e MCPs. `*`
concede acesso amplo de forma explícita; `!` nega um padrão correspondente e
tem prioridade. Cada nó declara quais Skills e MCPs usa. Validar a política e
cada nó no preparo do plugin, na validação da fonte e antes de nova run.
Informar perfil, flow, nó e ferramenta indevida na falha. Fazer o `doctor`
conferir somente os MCPs usados pelos nós do flow selecionado, no runtime
principal e no fallback configurado. Remover nomes privados de Skills e MCPs
do código genérico. Documentar a regra para os agentes em toda instalação.

## Non-goals / Fora de escopo

**[us]** This change does not hide the global agent catalog, inspect a Skill's
contents, control tool calls outside `flow-server`, or change active runs. It
does not require a policy on existing profiles during migration. It does not
add agent-level permissions; the same agent can run nodes with different tools.

**[pt]** Esta mudança não oculta o catálogo global do agente, inspeciona o
conteúdo de uma Skill, controla chamadas fora do `flow-server` nem altera runs
ativas. Ela não exige política nos perfis existentes durante a migração. Não
adiciona permissões por agente; o mesmo agente pode executar nós com
ferramentas diferentes.

## Impact / Impacto

**[us]** Source config validation, the flow node contract, guided run creation,
plugin setup, `doctor`, agent guidance, and public configuration docs change. Existing
profiles without `policy` retain their current Skill acceptance behavior until
they opt in; the fixed private MCP check is removed for every profile.

**[pt]** Mudam a validação da configuração, o contrato dos nós, a criação de runs
guiadas, o preparo do plugin, o `doctor`, as instruções dos agentes e a documentação pública. Perfis sem
`policy` mantêm a aceitação atual de Skills até aderirem; a checagem fixa de
MCP privado é removida para todos os perfis.

# Profile tool policy design / Design da política de ferramentas por perfil

## Configuration / Configuração

**[us]** Keep `policy` in each machine-local source entry in `sources.json`.
`skills` and `mcps` are bounded rule lists, not catalogs of every installed
tool. Each list supports exact names, `*` as a wildcard, and `!` before a rule
to deny matches. Rules match the full, lowercase tool name; `*` matches zero
or more characters. A deny wins regardless of order. An empty list denies
all tools of that type. A nonempty list must include a positive rule: `!*name*`
alone is invalid, while `["*", "!*name*"]` explicitly allows other names.
Reject unknown fields, duplicate rules, invalid patterns, and oversized lists.
Missing `policy` keeps legacy behavior during migration.

**[pt]** Manter `policy` em cada fonte local de `sources.json`. `skills` e
`mcps` são listas limitadas de regras, não catálogos de todas as ferramentas
instaladas. Cada lista aceita nomes exatos, `*` como curinga e `!` antes da
regra para negar correspondências. As regras comparam o nome completo da
ferramenta em letras minúsculas; `*` corresponde a zero ou mais caracteres.
Uma negação prevalece, independentemente da ordem. Lista vazia proíbe todas
as ferramentas daquele tipo. Lista não vazia exige regra positiva:
`!*nome*` sozinho é inválido, enquanto `["*", "!*nome*"]` permite os demais
nomes explicitamente. Rejeitar campos desconhecidos, regras duplicadas,
padrões inválidos e listas grandes. Sem `policy`, vale o comportamento anterior.

**[us]** `mcpRegistrations` is an optional map from a logical MCP name to
runtime-specific local registration names. Without a mapping, the logical
name is also the registration name. Both names must pass `policy.mcps`; a
safe alias cannot hide a denied registration. Codex and Claude own the real
command, URL, and credentials in their MCP configs. The policy stores none.

**[pt]** `mcpRegistrations` é um mapa opcional do nome lógico de um MCP para
nomes de registros locais por runtime. Sem mapeamento, o registro usa o mesmo
nome lógico. Ambos os nomes devem passar por `policy.mcps`; um nome lógico
permitido não pode esconder um registro proibido. Codex e Claude mantêm
comando, URL e credenciais reais nas próprias configurações MCP. A política
não armazena esses dados.

## Examples in the plugin / Exemplos no plugin

**[us]** The plugin reads the same `sources.json` used by the service. It does
not keep a second policy store. Example: two independent local profiles; one
allows all names except one naming pattern, and the other allows one Skill
and no MCP. Paths and names are illustrative.

**[pt]** O plugin lê o mesmo `sources.json` usado pelo serviço. Ele não mantém
outra cópia da política. Exemplo: dois perfis locais independentes; um permite
todos os nomes exceto um padrão, o outro permite uma Skill e nenhum MCP.
Caminhos e nomes são ilustrativos.

```json
{
  "schemaVersion": "v1",
  "sources": [
    {
      "id": "product-a",
      "mode": "local",
      "path": "/path/to/product-a/flows",
      "sync": { "pull": "confirm", "push": "manual" },
      "policy": {
        "skills": ["*", "!*product-b*"],
        "mcps": ["*", "!*product-b*"],
        "mcpRegistrations": {
          "design-tools": { "codex": "design-tools-a", "claude": "design-tools-a-claude" }
        }
      }
    },
    {
      "id": "product-b",
      "mode": "local",
      "path": "/path/to/product-b/flows",
      "sync": { "pull": "confirm", "push": "manual" },
      "policy": {
        "skills": ["test-evidence-audit"],
        "mcps": []
      }
    }
  ]
}
```

**[us]** In the flow YAML, each node lists only the logical MCP names it needs.
The existing `skills` field keeps the same role. `mcps: []` means the node
uses no profile MCP. The same agent role may appear in two nodes with
different permissions. A Skill that needs an MCP must have that MCP declared
by its node; the server cannot infer a Skill's hidden dependencies.

**[pt]** No YAML do flow, cada nó lista apenas os nomes lógicos de MCP de que precisa.
O campo `skills` existente continua com o mesmo papel. `mcps: []` indica que
o nó não usa MCP do perfil. O mesmo papel de agente pode aparecer em dois nós
com permissões diferentes. Se uma Skill precisa de MCP, o nó deve declará-lo;
o serviço não consegue inferir dependências internas da Skill.

```yaml
nodes:
  - id: inspect-ui
    agent: reviewer
    skills: [design-review]
    mcps: [design-tools]
  - id: inspect-tests
    agent: reviewer
    skills: [test-evidence-audit]
    mcps: []
```

**[us]** For `product-a`, `inspect-ui` may use `design-tools`. For
`product-b`, that same node is rejected before a run because its Skill and
MCP do not match positive rules. `inspect-tests` has no design MCP requirement
in either profile. A name containing `product-b` is denied in `product-a`
even when `*` matches it.

**[pt]** Em `product-a`, `inspect-ui` pode usar `design-tools`. Em
`product-b`, o mesmo nó é rejeitado antes da run porque Skill e MCP não
correspondem a regras positivas. `inspect-tests` não exige MCP de design em
nenhum perfil. Um nome contendo `product-b` é negado em `product-a` mesmo
quando `*` também corresponde a ele.

## Validation boundary / Limite de validação

**[us]** Match each declared Skill ID, logical MCP name, and resolved MCP
registration against its profile rules. Allow only when a positive rule
matches and no negative rule matches. Do not infer ownership from descriptions,
installation paths, agent roles, or the global catalog. Name patterns are a
convenience, not proof of tool ownership: an unrelated tool with a neutral
name may pass `*`. Validate every node during source validation and repeat
the check against the current policy before a new run. A violation has a
stable error code and names the profile, flow, node, and tool. Policy changes
apply to new runs; active runs keep their pinned flow definition.

**[pt]** Comparar cada Skill, nome lógico de MCP e registro MCP resolvido com
as regras do perfil. Permitir somente quando uma regra positiva corresponde
e nenhuma negativa corresponde. Não inferir a organização pela descrição,
caminho de instalação, papel do agente ou catálogo global. Padrões de nome
facilitam a configuração, mas não comprovam a organização dona: uma ferramenta
alheia com nome neutro pode passar pelo `*`. Validar cada nó na fonte e
repetir a checagem antes de nova run. A falha tem código estável e cita
perfil, flow, nó e ferramenta. Mudanças na política valem para novas runs;
runs ativas mantêm o flow fixado.

## Plugin setup and agent instructions / Preparo do plugin e instruções dos agentes

**[us]** On a new installation, the plugin validates a source policy when
the developer adds the source. On plugin startup and updates, it validates
existing local sources without changing or deleting their files. A clean
installation with no source reports "configure a source", not a policy error.
The plugin's `doctor` shows malformed patterns, missing explicit `*`, denied
node tools, and missing MCP mappings or registrations with profile, flow, node,
and runtime where relevant. It must not start a run when policy validation
fails. Shipped agent guidance and the quick guide explain the `*` and `!`
syntax, deny precedence, and the limit of name-based rules, using generic
examples. A new agent can read this guidance on any machine without private
profile names.

**[pt]** Em nova instalação, o plugin valida a política quando o dev adiciona
a fonte. Ao iniciar ou atualizar, valida fontes locais existentes sem alterar
nem apagar seus arquivos. Instalação limpa sem fonte informa "configure uma
fonte", não um erro de política. O `doctor` do plugin mostra padrões inválidos,
falta do `*` explícito, ferramentas negadas em nós e mapeamentos ou registros
MCP ausentes, com perfil, flow, nó e runtime quando fizer sentido. Uma run não
pode começar se a validação da política falhar. As instruções distribuídas aos
agentes e o guia rápido explicam `*`, `!`, prioridade da negação e o limite das
regras baseadas em nomes, com exemplos genéricos. Um novo agente consegue ler
essa orientação em qualquer máquina, sem nomes de perfis privados.

## Doctor and agent guidance / Doctor e orientação do agente

**[us]** For a selected profile and flow, `doctor` finds the union of MCP
names declared by its nodes. It resolves optional mappings, then checks only
those registrations for the primary runtime and configured fallback. A missing
registration is reported with profile, flow, node, runtime, and MCP. Unused MCPs
from the same profile and MCPs from other profiles do not block the flow. The
`flow-server` bridge check stays separate. Remove the fixed private
Skill-to-MCP check. Agent guidance says to use only node-declared Skills and
MCPs. This guides the agent; it cannot stop direct tool calls outside the
flow-server.

**[pt]** Para um perfil e flow selecionados, o `doctor` reúne os MCPs lógicos
declarados pelos seus nós. Ele resolve mapeamentos opcionais e verifica apenas
esses registros no runtime principal e no fallback configurado. Registro
ausente é informado com perfil, flow, nó, runtime e MCP. MCPs não usados do mesmo
perfil e MCPs de outros perfis não bloqueiam o flow. A checagem do bridge
`flow-server` continua separada. Remover a associação fixa de Skill para MCP
privado. A orientação diz ao agente para usar apenas Skills e MCPs declarados
no nó. Isso orienta o agente; não impede chamadas diretas fora do flow-server.

## Migration / Migração

**[us]** Add optional `policy` and node `mcps` without changing the v1
source-config version. First list current node Skills and MCP dependencies;
then define each profile's pattern rules and node usage. Keep private values in
local source config and private flow files, never public examples or logs.

**[pt]** Adicionar `policy` e `mcps` opcionais sem mudar a versão v1 da
configuração de fontes. Primeiro listar Skills e dependências MCP dos nós;
depois definir regras por perfil e o uso por nó. Manter valores
privados na configuração local e nos flows privados, nunca em exemplos ou
logs públicos.

## ADDED Requirements

### Requirement: Profiles externos por opt-in
O produto SHALL carregar apenas flows core distribuídos por padrão. Profiles e
flows externos SHALL exigir raiz configurada e profile explicitamente escolhido.

#### Scenario: Instalação pública limpa
- **WHEN** o usuário instala o pacote sem configuração adicional
- **THEN** nenhum profile pessoal, path `$HOME`, sessão ou configuração do dotfiles é descoberto ou carregado

### Requirement: Precedência e contenção de paths
O loader SHALL validar nomes, canonicalizar paths e documentar a precedência
core < flow externo < profile explicitamente selecionado.

#### Scenario: Path fora da raiz autorizada
- **WHEN** profile/flow resolve fora de diretório configurado
- **THEN** o loader rejeita a entrada sem ler seu conteúdo

### Requirement: Limite de distribuição
O build público SHALL usar allowlist e testes para excluir profiles privados,
configurações pessoais, credenciais, sessões, logs e runs reais.


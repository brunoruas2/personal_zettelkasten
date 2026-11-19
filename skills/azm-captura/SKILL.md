---
name: azm-captura
description: Transforma fala ou texto solto sobre um assunto em zettels de Conteúdo atômicos e ligados (AZM). Use quando o usuário despejar o que aprendeu, pedir "guarda isso" ou citar uma fonte. Busca antes de criar, escreve só em "## Captura", deixa o nível em semente e relata o que criou e atualizou.
---

# azm-captura

Fala solta vira conceitos atômicos: um conceito por zettel, título curto e único.

Use só as tools do MCP do Zettelkasten.

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nível `consolidado` (reservado ao usuário).
- Nunca renomeie nem apague sem confirmação.
- Nunca entregue a resposta de exercício que o usuário deve resolver.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão ao usuário e **não contorne**.

## Passos

1. `list_types`: precisa de `conteudo` (e `fonte`, se houver fonte a registrar). Sem `conteudo`, diga que cadastre (`skills/README.md`) e não grave.
2. **Separe os conceitos** da fala. Uma ideia por zettel; "JOIN" e "normalização" são dois.
3. Para cada conceito, `search_zettels` **antes**:
   - **Já existe:** `read_zettel` e `edit_zettel` por trecho, acrescentando só dentro de `## Captura`. Não toque em `## Minha síntese`, mesmo que haja texto do usuário lá.
   - **Não existe:** `create_zettel` com `type: "conteudo"`, nível `semente`, e o texto em `## Captura` (mantenha as seções do template, `## Minha síntese` vazia).
4. **Ligue:** `[[título]]` aos conceitos relacionados (também entre os criados agora) e `[[^título da trilha]]` à trilha pai quando houver.
5. **Fonte citada** (livro, artigo, aula): crie ou ligue um zettel `fonte` com a referência **como o usuário a deu**. Não invente autor, ano, link nem página. Sem o tipo `fonte`, registre a referência em texto na `## Captura` e avise que o tipo falta.
6. Se o `set_type` for necessário depois da criação, use nível `semente`; nunca outro.

## Relatório final

Liste, em português, os títulos **criados** e os **alterados**, e qualquer recusa do servidor (informe a razão, não repita a escrita, devolva o assunto ao usuário). Avise depois de escrever; não peça permissão antes.

---
name: azm-trilha
description: Cria e ajusta a trilha (plano de estudo) de um assunto no Zettelkasten (AZM). Use quando o usuário quiser planejar o estudo de um tema, montar roadmap ou inserir/reordenar tópicos de uma trilha. Propõe tópicos, ordem, dependências, horas e fontes, e só grava depois da aprovação explícita.
---

# azm-trilha

Planeja o estudo de um assunto e grava um zettel do tipo `trilha`. **Primeiro propõe; só grava depois de aprovação explícita.**

Use só as tools do MCP do Zettelkasten.

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nível `consolidado` (reservado ao usuário).
- Nunca renomeie nem apague sem confirmação.
- Nunca entregue a resposta de exercício que o usuário deve resolver.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão ao usuário e **não contorne**.

## Passos

1. `list_types`: precisa do tipo `trilha`. Se faltar, diga que cadastre (definição em `skills/README.md`) e não grave nada.
2. `search_zettels` pelo assunto: existe trilha com o mesmo título ou tema? Então proponha **ajustá-la**, não criar outra. Veja também conteúdos já existentes para citar.
3. **Proponha** ao usuário, sem escrever: tópicos, ordem, dependências entre eles, estimativa de horas e fontes sugeridas. Pergunte se pode gravar.
4. **Aprovado:** `create_zettel` com `type: "trilha"`, título curto, corpo com um `[[título]]` por tópico na ordem e as horas/fontes em texto. Tópicos que já existem como zettel são ligados pelo título exato; não crie os conteúdos aqui (isso é a `azm-captura`).
5. **Ajuste de trilha existente** (inserir tópico, reordenar): `read_zettel`, depois `edit_zettel` por trecho acrescentando só o necessário. Preserve o que o usuário escreveu.
6. Não atribua nível à trilha; `beta`/`estavel` é decisão do usuário.

## Relatório final

Termine dizendo, em português, quais zettels **criou** e quais **alterou** (títulos), e qualquer recusa do servidor. Avise depois de escrever; não peça permissão antes, salvo renomear e apagar.

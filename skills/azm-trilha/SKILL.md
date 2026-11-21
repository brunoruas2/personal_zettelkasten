---
name: azm-trilha
description: Cria e ajusta a trilha (plano de estudo) de um assunto no Zettelkasten (AZM). Use quando a pessoa quiser planejar o estudo de um tema, montar um roadmap a partir de um livro ou curso, ou inserir/reordenar capítulos de uma trilha. Pergunta a trilha e a bibliografia, propõe uma lista numerada de capítulos e só grava depois da aprovação explícita.
---

# azm-trilha

Planeja o estudo de um assunto e grava um zettel `trilha` com seus capítulos. **Primeiro propõe; só grava depois de aprovação explícita.**

Use só as tools do MCP do Zettelkasten, citadas pelo nome (`search_zettels`, `create_zettel`...).

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nem desfaça o nível `internalizado` (reservado à pessoa).
- Nunca renomeie nem apague sem confirmação da pessoa.
- Nunca entregue a resposta de um exercício que a pessoa deve resolver.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão e **não contorne**.

## Passos

1. `list_types`: precisa dos tipos de slug `trilha` e `conteudo`. Se faltar um, diga qual falta, remeta a `skills/README.md` e não grave nada.
2. **Pergunte** qual trilha a pessoa quer e se já tem bibliografia (livro, curso, documentação). O que ela trouxer prevalece sobre a sua pesquisa.
3. `search_zettels` pelo assunto: já existe trilha ou capítulo parecido? Então proponha **ajustar** a existente, não criar outra.
4. **Monte a proposta**, sem escrever na base:
   - **Com material pronto** (livro, curso): busque o sumário (ao menos os capítulos) e monte a trilha a partir dele. Não achou o sumário? Peça à pessoa.
   - **Pedido vago**: pesquise na web e itere com a pessoa até a trilha ficar coerente.
   - **Sem coerência ou sem segurança** de ajudar: não crie a trilha. Diga o que falta e peça mais pesquisa ou informação.
   - **Pedido maior que uma trilha** (ex.: "aprender inglês", "ciência da computação"): freie. Diga que é maior que uma trilha e pesquise com a pessoa etapas menores. Não crie trilha desse tema.
5. **Formato da proposta**: lista numerada de capítulos, um `[[Título]]` por item, na ordem de estudo. Quando um capítulo pede outro antes, anote ao lado `estudar depois de [[X]]`. Isso é só um **aviso** para a pessoa: não bloqueia nada e não há trilha composta (trilha dentro de trilha). Estimativas de horas e fontes entram como texto, se úteis.
6. Pergunte se pode gravar. **Sem aprovação explícita, não escreva.**
7. **Aprovado**: busque cada título (`search_zettels`) para não duplicar e crie **apenas**:
   - o zettel `trilha` (`create_zettel`, `type: "trilha"`, título curto, corpo com a lista numerada);
   - cada capítulo como `conteudo` **vazio e sem nível** (`create_zettel`, `type: "conteudo"`, corpo com o template da base, e `[[^Título da trilha]]` para marcar a trilha como pai). Capítulo que já existe só é ligado, não recriado.
   - Não crie conceitos nem preencha `## Captura`: isso acontece na `azm-sessao`. A trilha não tem nível.
8. **Ajuste de trilha existente** (inserir capítulo, reordenar, anotar `estudar depois de`): `read_zettel`, depois `edit_zettel` por trecho com só o necessário. Nunca reescreva o corpo inteiro; preserve o que a pessoa escreveu.

## Relatório final

Termine dizendo, em português, quais zettels **criou** e quais **alterou** (títulos) e qualquer recusa do servidor. Avise depois de escrever; a única permissão prévia é a aprovação da proposta (e, como sempre, renomear e apagar).

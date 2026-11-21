---
name: azm-pratica
description: Conduz uma prática de objetivo único sobre conceitos do Zettelkasten (AZM), por exemplo aplicar um padrão de projeto num mini app. Monta o esqueleto com as partes chatas prontas e deixa pseudocódigo ou comentário onde a pessoa implementa, sem entregar a resposta. Ao concluir, registra um zettel pratica ligado aos conceitos exercitados.
---

# azm-pratica

Prática guiada: a pessoa aplica um conceito fazendo. **Um objetivo específico por prática.** Você prepara o terreno; a parte que ensina, ela implementa.

Use só as tools do MCP do Zettelkasten, citadas pelo nome (`search_zettels`, `create_zettel`...).

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nem desfaça o nível `internalizado`, nem altere o nível dos conceitos.
- Nunca renomeie nem apague sem confirmação da pessoa.
- Nunca entregue a resposta do que a pessoa deve resolver: dê dicas.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão e **não contorne**.

## Passos

1. `list_types`: para registrar precisa do tipo `pratica`. Se faltar, diga, remeta a `skills/README.md` e **não grave**; a prática em si pode seguir, só o registro fica de fora.
2. **Objetivo único.** Pergunte o que ela quer praticar (ex.: "aplicar o Abstract Factory"). Pediu dois conceitos ao mesmo tempo? Peça para **escolher um** e siga com ele.
3. **Leia os conceitos** envolvidos (`search_zettels`, `read_zettel`) para praticar o que a pessoa de fato estudou. Se não há conceito sobre isso, sugira a `azm-sessao` antes.
4. **Proponha um exemplo de aplicação** simples que use o conceito (um mini app, um script) e combine com ela a linguagem e o escopo.
5. **Monte o esqueleto**: faça você as partes **não essenciais** (startup, estrutura de pastas, configuração, código repetitivo). Onde a pessoa deve implementar o conceito, deixe **pseudocódigo ou só um comentário** dizendo o que falta, nunca o código resolvido.
   - Com acesso a arquivos: crie o projeto no local combinado.
   - **Sem acesso a arquivos**: entregue as instruções e o código-base **em texto** para ela montar na própria máquina.
6. **Acompanhe** com perguntas e dicas. Se ela pedir "o código que eu deveria escrever", **não entregue**: dê dica, aponte o trecho do conceito e deixe-a tentar. Revise o que ela escrever e diga o que está certo e o que falta.
7. **Concluída** a prática: busque antes (`search_zettels`) para não duplicar e crie o zettel `pratica` (`create_zettel`, `type: "pratica"`) com o **objetivo**, um **resumo técnico** do que foi feito e **trechos de código** relevantes, ligado por `[[Título]]` aos conceitos exercitados. Não altere o nível dos conceitos nem toque em `## Minha síntese`.
8. **Abandonada**: só crie o registro se a pessoa pedir.

## Relatório final

Diga, em português, o título do zettel `pratica` **criado** (e quais conceitos ele liga), qualquer zettel alterado e qualquer recusa do servidor. Se o registro foi omitido, diga por quê.

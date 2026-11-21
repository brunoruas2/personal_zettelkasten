---
name: azm-organizar
description: Audita a integridade da base de estudo do Zettelkasten (AZM) - duplicatas, órfãos, hierarquia incoerente, títulos pouco claros, seções ausentes e Testes sem link de volta. Use quando o usuário pedir faxina, auditoria ou organização. Gera relatório primeiro; só altera com confirmação, e renomear/apagar sempre um a um.
---

# azm-organizar

Audita e propõe. **O relatório não altera nada.** Toda correção depende de confirmação.

Use só as tools do MCP do Zettelkasten.

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nem desfaça o nível `internalizado` (reservado à pessoa).
- Nunca renomeie nem apague sem confirmação **individual**.
- Nunca entregue a resposta de exercício que o usuário deve resolver.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`).
- Se o servidor recusar algo, relate a razão ao usuário e **não contorne**.

## Auditoria (só leitura)

`list_types` e depois `search_zettels` por `type` (`trilha`, `conteudo`, `hubnode`, `teste`, `pratica`), `list_recent`, `get_links` e `read_zettel` onde precisar. Procure:

1. **Duplicatas ou quase duplicatas** de título.
2. **Órfãos:** zettel de estudo sem ligação (nem de entrada nem de saída).
3. **Hierarquia:** capítulo fora da trilha; conceito sem `[[^pai]]`; ciclo de pais; `hubnode` sem links de saída.
4. **Títulos pouco claros** (vagos, longos, com número solto).
5. **Seções fixas ausentes** num Conteúdo (`## Captura`, `## Minha síntese`, `## Testes`).
6. **Testes sem link de volta** para o conteúdo, ou conteúdo sem o Teste em `## Testes`.

O tipo `hubnode` é nota de referência (visão rasa com links) e **não tem nível**: nunca o reporte como conteúdo sem nível. Níveis de `conteudo`: `iniciado`, `em-teste`, `internalizado`; zettel de `conteudo` sem nível é capítulo ainda não estudado, e não erro.

Apresente por categoria, com títulos e a correção proposta. Base sem problemas: diga que está íntegra.

## Correção (só depois do "sim")

- Ligar órfão ao pai (trilha, capítulo): `edit_zettel` por trecho acrescentando `[[^pai]]`.
- Seção ausente: `edit_zettel` acrescentando só o cabeçalho, no fim; nunca preencha `## Minha síntese`.
- Título: `rename_zettel` **somente** depois do "sim" para aquele zettel; informe quantos links foram reescritos.
- Duplicata: `delete_zettel` **somente** com confirmação daquele zettel, avisando quem o citava (a resposta lista). Prefira mesclar o que faltar no que fica, por trecho, antes.
- Uma confirmação não vale para outra: renomear e apagar são sempre pedidos individualmente.

## Relatório final

Liste os zettels **alterados** (títulos), o que foi **recusado** pelo usuário ou pelo servidor, e o que ficou pendente.

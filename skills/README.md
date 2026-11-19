# Skills AZM

Skills do agente para o **AZM — AI Zettelkasten Model** (zettel `202611181755066mhh`, seções 4 e 5). Usam só o MCP do Zettelkasten (`/api/mcp`, chave `zk_`). O zettel é a fonte da verdade do modelo; se a skill divergir dele, o zettel vence.

## Skills

| Skill | Papel | Escreve? |
|---|---|---|
| `azm-sessao` | Porta de entrada: escolhe a trilha, mostra onde parou, oferece os caminhos | não |
| `azm-trilha` | Propõe e grava o plano de um assunto | sim, com aprovação |
| `azm-captura` | Fala solta vira conteúdos atômicos ligados | sim |
| `azm-tutor` | Explica e verifica; guarda via `azm-captura` | não |
| `azm-teste` | Bateria de perguntas; registra no zettel Teste; sobe até `testado` | sim |
| `azm-consolidar` | Lembra o que está pronto para a síntese do usuário | não |
| `azm-organizar` | Audita duplicatas, órfãos, hierarquia e seções | sim, com confirmação |

## Tipos recomendados

O agente **não cria nem edita tipos** (só o usuário, no painel "Tipos de zettel"). As skills procuram estes slugs com `list_types`; se faltar o necessário, param e dizem qual cadastrar.

| Tipo | Slug | `counts_progress` | Seção protegida | Níveis (chave, emoji) | Template |
|---|---|---|---|---|---|
| Conteúdo | `conteudo` | sim | `Minha síntese` | `semente` 🤖, `testado` 💾, `consolidado` 🧠 (`user_only`) | `## Captura` / `## Minha síntese` / `## Testes` |
| Trilha | `trilha` | não | — | `beta`, `estavel` | `## Plano` |
| Teste | `teste` | não | — | — | `## Sessões` |
| Fonte | `fonte` | não | — | — | `## Referência` |
| Prática | `pratica` | não | — | — | `## Enunciado` |

Template do Conteúdo (literal):

```
## Captura

## Minha síntese

## Testes
```

## O que cada skill lê e escreve

| Skill | Lê | Escreve |
|---|---|---|
| `azm-sessao` | trilhas, `trail_progress`, conteúdos | nada |
| `azm-trilha` | trilhas, conteúdos | zettel `trilha` |
| `azm-captura` | conteúdos, fontes, trilha | `conteudo` (`## Captura`), `fonte` |
| `azm-tutor` | conteúdo do tema | nada |
| `azm-teste` | conteúdo, teste do tema | `teste` (sessões), `## Testes` do conteúdo, nível até `testado` |
| `azm-consolidar` | conteúdos `testado`, testes | nada |
| `azm-organizar` | tudo do estudo | links, títulos e seções, sempre com confirmação |

## Regras de autoria (todas as skills de escrita)

1. Nunca editar `## Minha síntese`.
2. Nunca marcar `consolidado` (nível reservado ao usuário).
3. Nunca renomear nem apagar sem confirmação.
4. Nunca entregar a resposta de um exercício que o usuário deve resolver.
5. Escrever por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.

O servidor **recusa** os itens 1 e 2 para o agente; a skill só evita tentativas inúteis. Recusa é relatada ao usuário, nunca contornada. Depois de escrever, a skill avisa com um relatório (títulos criados e alterados). Sem cobrança: nada de status fora da conversa ou sem o usuário pedir.

## Instalar e validar

```bash
python scripts/install_skills.py              # ~/.claude/skills/
python scripts/install_skills.py --project    # .claude/skills/ deste repositório
python scripts/install_skills.py --dry-run    # só lista
python scripts/check_skills.py                # valida frontmatter, tamanho e tools citadas
python -m unittest discover scripts/tests     # testes dos scripts
```

Mudou uma tool do MCP ou o zettel AZM: revisar as skills e rodar `check_skills.py`.

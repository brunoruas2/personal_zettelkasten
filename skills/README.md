# Skills AZM

Skills do agente para o **AZM — AI Zettelkasten Model** (zettel `202611181755066mhh`; backlog `20261120012236ujoy`). Usam só o MCP do Zettelkasten (`/api/mcp`, chave `zk_`) e funcionam em Claude e GitHub Copilot. O zettel é a fonte da verdade do modelo; se a skill divergir dele, o zettel vence.

A cadeia de estudo é trilha → capítulo → (conceitos). Capítulo e conceito são o **mesmo tipo** `conteudo`; o capítulo só vira `hubnode` quando é separado em conceitos.

## Skills

| Skill | Papel | Escreve? |
|---|---|---|
| `azm-trilha` | Pergunta o assunto e a bibliografia, propõe a lista de capítulos e grava a trilha | sim, só após aprovação |
| `azm-sessao` | Sessão de estudo numa trilha: mostra onde parou, questiona sem ensinar, capta e ajusta o nível | sim (`## Captura` e nível) |
| `azm-teste` | Sessão de teste de 15–20 min, uma questão aberta por vez; registra um zettel `teste` | sim, nunca promove |
| `azm-pratica` | Prática de objetivo único: esqueleto com lacunas e zettel `pratica` ao fim | sim (zettel `pratica`) |
| `azm-organizar` | Audita duplicatas, órfãos, hierarquia e seções | sim, com confirmação |

## Tipos recomendados

O agente **não cria nem edita tipos** (só a pessoa, no painel "Tipos de zettel"). As skills procuram estes slugs com `list_types`; se faltar o necessário, param e dizem qual cadastrar. Não existe tipo `fonte`: a fonte vai como texto na `## Captura`.

| Tipo | Slug | `counts_progress` | Seção protegida | Níveis (chave) | Template |
|---|---|---|---|---|---|
| Trilha | `trilha` | não | — | — | `## Plano` |
| Conteúdo | `conteudo` | sim | `Minha síntese` | `iniciado` → `em-teste` → `internalizado` (`user_only`) | `## Captura` / `## Minha síntese` / `## Testes` |
| Hubnode | `hubnode` | não | — | — | visão rasa com links |
| Teste | `teste` | não | — | — | perguntas e resumos das respostas |
| Prática | `pratica` | não | — | — | objetivo, resumo técnico e trechos |

Use sempre as **chaves** em `set_type` (`em-teste`, com hífen). `internalizado` é só da pessoa: o servidor recusa o agente. Capítulo sem nível é capítulo ainda não estudado.

Template do Conteúdo (literal):

```
## Captura

## Minha síntese

## Testes
```

## O que cada skill lê e escreve

| Skill | Lê | Escreve |
|---|---|---|
| `azm-trilha` | trilhas, conteúdos | zettel `trilha` e capítulos `conteudo` vazios, sem nível |
| `azm-sessao` | trilha, capítulos e conceitos (`read_zettel`, `get_links`) | `## Captura`, nível `iniciado`/`em-teste`, conceitos novos, conversão em `hubnode` |
| `azm-teste` | conceitos, testes anteriores | um `teste` por sessão (`create_zettel`) e a referência em `## Testes` dos conceitos (`edit_zettel`) |
| `azm-pratica` | conceitos | zettel `pratica` ligado aos conceitos |
| `azm-organizar` | tudo do estudo | links, títulos e seções, sempre com confirmação |

## Contornos vigentes até o bloco 2

As tools `trail_progress` e `log_test_session` ainda seguem o desenho antigo; as skills **não as usam**:

- **Andamento:** a `azm-sessao` desce trilha → capítulo → conceitos com `read_zettel` e `get_links`, lendo tipo e nível de cada zettel.
- **Registro de teste:** `create_zettel` (`type: teste`, título temporal) mais `edit_zettel` em `## Testes` de cada conceito.
- **Fonte:** texto livre na `## Captura`.
- **Síntese sugerida:** a `azm-teste` conta as passagens (testes em `## Testes`, 5 ou mais) e as práticas (1 ou mais) lendo os zettels.

Quando o bloco 2 chegar, trocar os contornos e rodar `check_skills.py`.

## Regras de autoria (todas as skills de escrita)

1. Nunca editar `## Minha síntese`.
2. Nunca marcar nem desfazer `internalizado` (nível reservado à pessoa).
3. Nunca renomear nem apagar sem confirmação.
4. Nunca entregar a resposta de um exercício que a pessoa deve resolver.
5. Escrever por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.

O servidor **recusa** os itens 1 e 2 para o agente; a skill só evita tentativas inúteis. Recusa é relatada, nunca contornada (por exemplo, não se reescreve o corpo inteiro para driblar a seção protegida). Por isso um capítulo com `## Minha síntese` preenchida, ou `internalizado`, não é convertido em `hubnode` pelo agente. Depois de escrever, a skill avisa com um relatório (títulos criados e alterados), sem pedir permissão antes, salvo renomear, apagar e gravar a trilha.

## Instalar e validar

```bash
python scripts/install_skills.py                               # pergunta agente e harness (TTY)
python scripts/install_skills.py --agent claude --harness cli  # ~/.claude/skills/
python scripts/install_skills.py --agent copilot --harness vscode --project  # .github/skills/ do repositório
python scripts/install_skills.py --dry-run --yes               # só lista; --yes usa os padrões (claude, cli)
python scripts/check_skills.py                                 # valida frontmatter, tamanho e tools citadas
python -m unittest discover scripts/tests                      # testes dos scripts
```

Flags: `--agent claude|copilot`, `--harness cli|vscode` (Claude: `cli`; Copilot: `cli` ou `vscode`), `--project` (instala no repositório em vez do usuário), `--link` (symlink em vez de cópia), `--dry-run`, `--yes`. Sem TTY o instalador nunca pergunta. Os destinos ficam numa tabela única no topo do script, com as fontes da documentação.

Ao final o instalador imprime como configurar o MCP do agente escolhido, sempre com o placeholder `<SUA_CHAVE_zk_>`; ele nunca lê, grava nem imprime uma chave real:

- **Claude:** `claude mcp add --transport http zettelkasten <URL>/api/mcp --header "Authorization: Bearer <SUA_CHAVE_zk_>"`.
- **Copilot:** bloco `mcpServers` (`type: http`, `url`, `headers`) em `~/.copilot/mcp-config.json`; no VS Code, a chave vem de variável de ambiente.

**Skills obsoletas.** O instalador remove automaticamente do destino somente `azm-captura`, `azm-tutor` e `azm-consolidar` (as de versões anteriores), listando cada remoção; com `--dry-run` só lista. Qualquer outra pasta `azm-*` que não venha deste repositório é mantida e apenas avisada.

Mudou uma tool do MCP ou o zettel AZM: revisar as skills e rodar `check_skills.py`.

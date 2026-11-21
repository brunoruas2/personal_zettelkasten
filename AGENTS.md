# AGENTS.md

As instruções deste repositório estão em [`CLAUDE.md`](./CLAUDE.md). Leia-o primeiro.

## Modelo teórico que rege o desenvolvimento

O zettel **"AI Zettelkasten Model - AZM"** (id `202611181755066mhh`, `https://personal-zettel.app.br/?z=202611181755066mhh`) é a fonte da verdade do modelo de estudo (AZM): tipos de zettel, skills `azm-*`, ciclo de sessão, maturidade por tipo, regras de autoria do agente e as features necessárias ao sistema. O backlog por blocos está no zettel `20261120012236ujoy`.

- Leia-o (MCP `read_zettel`, ou a skill `zettelkasten-db` com `GET /api/zettels/202611181755066mhh`) antes de projetar ou implementar tipos, níveis de maturidade, seções protegidas, skills do agente ou o mapa de maturidade.
- Se o código ou uma spec divergir do zettel, não resolva sozinho: pergunte ao usuário.
- Tipos: `trilha`, `conteudo`, `hubnode`, `teste`, `pratica` (não há `fonte`). Escada do `conteudo`, por chave: `iniciado` → `em-teste` → `internalizado` (só a pessoa).
- As skills `azm-*` ficam em `skills/` (fonte versionada; `.claude/` é ignorado) e são cinco: `azm-trilha`, `azm-sessao`, `azm-teste`, `azm-pratica`, `azm-organizar`. A change que as implementa é `openspec/changes/azm-skills-v2`. `skills/README.md` traz tipos, contornos até o bloco 2 e regras de autoria.
- Instalação multi-agente (Claude e GitHub Copilot): `python scripts/install_skills.py [--agent claude|copilot] [--harness cli|vscode] [--project] [--link] [--dry-run] [--yes]`; remove do destino só `azm-captura`, `azm-tutor` e `azm-consolidar`. Valide com `python scripts/check_skills.py` (roda no CI). **Mudou uma tool do MCP ou o zettel AZM: revise as skills.**
- O agente nunca edita `## Minha síntese` nem marca ou desfaz o nível `internalizado`: essas regras valem para o desenvolvimento e para o comportamento do agente.

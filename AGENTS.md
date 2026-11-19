# AGENTS.md

As instruções deste repositório estão em [`CLAUDE.md`](./CLAUDE.md). Leia-o primeiro.

## Modelo teórico que rege o desenvolvimento

O zettel **"AI Zettelkasten Model - AZM"** (id `202611181755066mhh`, `https://personal-zettel.app.br/?z=202611181755066mhh`) é a fonte da verdade do modelo de estudo (AZM): tipos de zettel, skills `azm-*`, ciclo de sessão, maturidade por tipo, regras de autoria do agente e as features necessárias ao sistema.

- Leia-o (MCP `read_zettel`, ou a skill `zettelkasten-db` com `GET /api/zettels/202611181755066mhh`) antes de projetar ou implementar tipos, níveis de maturidade, seções protegidas, skills do agente ou o mapa de maturidade.
- Se o código ou uma spec divergir do zettel, não resolva sozinho: pergunte ao usuário.
- A change em andamento que o implementa é `openspec/changes/zettel-types`.
- As skills `azm-*` ficam em `skills/` (fonte versionada; `.claude/` é ignorado). Instale com `python scripts/install_skills.py`, valide com `python scripts/check_skills.py` (roda no CI). **Mudou uma tool do MCP ou o zettel AZM: revise as skills.**
- O agente nunca edita `## Minha síntese` nem marca o nível de consolidado: essas regras valem para o desenvolvimento e para o comportamento do agente.

#!/usr/bin/env python3
"""Instala as skills AZM (skills/azm-*) onde o agente escolhido as carrega.

Agentes: claude e copilot (harness: cli, vscode). Os destinos ficam SÓ na tabela
TARGETS abaixo; mudar um caminho é mudar uma linha. Por padrão copia para o
diretório do usuário; com --project, para o diretório do repositório. Idempotente:
substitui só as pastas azm-* e nunca toca em outras skills. Remove do destino apenas
as skills da lista fixa OBSOLETE. Nunca lê, pede, grava nem imprime chave de API.
Só biblioteca padrão.

Uso: python scripts/install_skills.py [--agent claude|copilot] [--harness cli|vscode]
                                      [--project] [--link] [--dry-run] [--yes]
"""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Fontes da tabela (consultadas em 2026-11-21):
#  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
#    (CLI: projeto .github/skills, .claude/skills, .agents/skills; usuário ~/.copilot/skills,
#     ~/.agents/skills; frontmatter name e description obrigatórios, name minúsculo com hífens)
#  - https://code.visualstudio.com/docs/copilot/customization/agent-skills
#    (VS Code, harness Copilot: .github/skills/ e ~/.copilot/skills/; name até 64 caracteres,
#     minúsculas/números/hífens, igual à pasta; description até 1024)
#  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
#    (CLI: ~/.copilot/mcp-config.json, mcpServers, type "http", url, headers, tools)
#  - https://code.visualstudio.com/docs/agents/reference/mcp-configuration
#    (VS Code, harness Copilot: mesmo ~/.copilot/mcp-config.json; headers aceitam ${VAR})
# Claude Code: ~/.claude/skills e .claude/skills (convenção já usada neste repositório).
# "verified": False = não confirmado na documentação; o script avisa ao usar.
MCP_URL = "<URL_DO_SEU_ZETTELKASTEN>/api/mcp"

_MCP_CLAUDE = (
    "claude mcp add --transport http zettelkasten " + MCP_URL + " \\\n"
    '  --header "Authorization: Bearer <SUA_CHAVE_zk_>"'
)
_MCP_COPILOT_CLI = (
    "Em ~/.copilot/mcp-config.json (ou `copilot mcp add --transport http`):\n"
    '{\n  "mcpServers": {\n    "zettelkasten": {\n      "type": "http",\n'
    '      "url": "' + MCP_URL + '",\n'
    '      "headers": { "Authorization": "Bearer <SUA_CHAVE_zk_>" },\n'
    '      "tools": ["*"]\n    }\n  }\n}'
)
_MCP_COPILOT_VSCODE = (
    "Em ~/.copilot/mcp-config.json (usuário) ou .mcp.json na raiz do workspace;\n"
    "a chave vem da variável de ambiente ZETTEL_API_KEY (não grave a chave no arquivo):\n"
    '{\n  "mcpServers": {\n    "zettelkasten": {\n      "type": "http",\n'
    '      "url": "' + MCP_URL + '",\n'
    '      "headers": { "Authorization": "Bearer ${ZETTEL_API_KEY}" },\n'
    '      "tools": ["*"]\n    }\n  }\n}'
)

TARGETS = {
    ("claude", "cli"): {
        "user": Path.home() / ".claude" / "skills",
        "project": Path(".claude") / "skills",
        "mcp": _MCP_CLAUDE,
        "verified": True,
    },
    ("copilot", "cli"): {
        "user": Path.home() / ".copilot" / "skills",
        "project": Path(".github") / "skills",
        "mcp": _MCP_COPILOT_CLI,
        "verified": True,
    },
    ("copilot", "vscode"): {
        "user": Path.home() / ".copilot" / "skills",
        "project": Path(".github") / "skills",
        "mcp": _MCP_COPILOT_VSCODE,
        "verified": True,
    },
}
DEFAULT_AGENT = "claude"
DEFAULT_HARNESS = "cli"

# Skills removidas pela change azm-skills-v2: as únicas que o instalador apaga do destino.
OBSOLETE = ("azm-captura", "azm-tutor", "azm-consolidar")


def agents() -> list:
    return sorted({a for a, _ in TARGETS})


def harnesses(agent: str) -> list:
    return sorted(h for a, h in TARGETS if a == agent)


def source_skills(skills_dir: Path) -> list:
    return sorted(p for p in skills_dir.glob("azm-*") if (p / "SKILL.md").is_file())


def remove(target: Path) -> None:
    if target.is_symlink() or target.is_file():
        target.unlink()
    elif target.exists():
        shutil.rmtree(target)


def resolve_dest(agent: str, harness: str, project: bool, root: Path = ROOT) -> Path:
    t = TARGETS[(agent, harness)]
    return root / t["project"] if project else t["user"]


def install(skills_dir: Path, dest: Path, link: bool = False, dry_run: bool = False) -> list:
    """Instala e devolve as linhas do que fez (ou faria, em --dry-run)."""
    actions = []
    for src in source_skills(skills_dir):
        target = dest / src.name
        verb = "link" if link else "copia"
        actions.append(f"{verb}: {src.name} -> {target}" + (" (substitui)" if target.exists() or target.is_symlink() else ""))
        if dry_run:
            continue
        dest.mkdir(parents=True, exist_ok=True)
        remove(target)
        if link:
            target.symlink_to(src.resolve(), target_is_directory=True)
        else:
            shutil.copytree(src, target)
    return actions


def remove_obsolete(dest: Path, dry_run: bool = False) -> list:
    """Remove do destino só as skills de OBSOLETE; devolve as linhas do que fez."""
    actions = []
    for name in OBSOLETE:
        target = dest / name
        if not (target.exists() or target.is_symlink()):
            continue
        if dry_run:
            actions.append(f"removeria (obsoleta): {target}")
        else:
            remove(target)
            actions.append(f"removida (obsoleta): {target}")
    return actions


def unknown_warnings(skills_dir: Path, dest: Path) -> list:
    """Avisa sobre pastas azm-* do destino que não estão na fonte nem em OBSOLETE."""
    if not dest.is_dir():
        return []
    known = {p.name for p in source_skills(skills_dir)} | set(OBSOLETE)
    return [
        f"aviso: {p.name} em {dest} não vem deste repositório; mantida"
        for p in sorted(dest.glob("azm-*"))
        if p.name not in known
    ]


def _ask(label: str, options: list, default: str) -> str:
    answer = input(f"{label} [{'/'.join(options)}] (padrão {default}): ").strip().lower()
    return answer or default


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Instala as skills AZM.")
    ap.add_argument("--agent", help=f"agente: {', '.join(agents())}")
    ap.add_argument("--harness", help="ambiente do agente (ex.: cli, vscode)")
    ap.add_argument("--project", action="store_true", help="instala no diretório do repositório")
    ap.add_argument("--link", action="store_true", help="symlink em vez de cópia (no Windows pode exigir permissão)")
    ap.add_argument("--dry-run", action="store_true", help="só lista o que faria")
    ap.add_argument("--yes", action="store_true", help="não pergunta; usa padrões (claude, cli)")
    ap.add_argument("--skills", type=Path, default=ROOT / "skills", help=argparse.SUPPRESS)
    ap.add_argument("--dest", type=Path, default=None, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    interactive = not args.yes and sys.stdin.isatty()
    agent = args.agent
    if agent is None:
        agent = _ask("Agente", agents(), DEFAULT_AGENT) if interactive else DEFAULT_AGENT
    if agent not in agents():
        print(f"agente desconhecido: {agent}. Aceitos: {', '.join(agents())}", file=sys.stderr)
        return 2
    harness = args.harness
    if harness is None:
        if interactive:
            hs = harnesses(agent)
            harness = _ask("Harness", hs, DEFAULT_HARNESS if DEFAULT_HARNESS in hs else hs[0])
        else:
            harness = DEFAULT_HARNESS if (agent, DEFAULT_HARNESS) in TARGETS else harnesses(agent)[0]
    if (agent, harness) not in TARGETS:
        print(f"harness desconhecido para {agent}: {harness}. Aceitos: {', '.join(harnesses(agent))}", file=sys.stderr)
        return 2

    target = TARGETS[(agent, harness)]
    dest = args.dest if args.dest is not None else resolve_dest(agent, harness, args.project)

    if not source_skills(args.skills):
        print(f"nenhuma skill azm-* em {args.skills}", file=sys.stderr)
        return 1
    if not target["verified"]:
        print(f"AVISO: destino de {agent}/{harness} não verificado na documentação; confira o caminho: {dest}")
    try:
        for line in install(args.skills, dest, link=args.link, dry_run=args.dry_run):
            print(line)
        for line in remove_obsolete(dest, dry_run=args.dry_run):
            print(line)
        for line in unknown_warnings(args.skills, dest):
            print(line)
    except OSError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1
    if args.dry_run:
        print("(dry-run: nada foi gravado)")
    print(f"\nConfigure o MCP do Zettelkasten no {agent} ({harness}); substitua o placeholder pela sua chave zk_:\n")
    print(target["mcp"])
    return 0


if __name__ == "__main__":
    sys.exit(main())

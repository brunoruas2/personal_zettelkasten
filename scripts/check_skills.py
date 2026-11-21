#!/usr/bin/env python3
"""Valida as skills AZM em skills/*/SKILL.md.

Confere, para cada skill:
  - frontmatter com `name` igual ao nome da pasta e `description` de até 1024 caracteres;
  - corpo de até 200 linhas;
  - nenhuma das skills removidas (azm-captura, azm-tutor, azm-consolidar) existe;
  - toda tool citada como `nome_da_tool` existe no MCP (apps/api/internal/mcp/*.go).

Sai com código 1 e lista os problemas se algo falhar. Só biblioteca padrão.

Uso: python scripts/check_skills.py [--skills DIR] [--tools-dir DIR]
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_DESCRIPTION = 1024
MAX_BODY_LINES = 200

TOOL_RE = re.compile(r'Name:\s*"([a-z][a-z0-9_]*)"')
# Candidata a tool: `palavra_com_underscore` entre crases (o catálogo só usa snake_case).
CITED_RE = re.compile(r"`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\(|`)")
# snake_case que não é tool: parâmetros e campos do MCP.
NOT_TOOLS = {
    "old_string", "new_string", "counts_progress", "user_only",
    "protected_sections", "links_to", "linked_from",
}
# Skills removidas pela change azm-skills-v2: as pastas não podem voltar.
REMOVED_SKILLS = ("azm-captura", "azm-tutor", "azm-consolidar")


def load_tools(tools_dir: Path) -> set:
    names = set()
    for f in sorted(tools_dir.glob("tools*.go")):
        if f.name.endswith("_test.go"):
            continue
        names.update(TOOL_RE.findall(f.read_text(encoding="utf-8")))
    return names


def split_frontmatter(text: str):
    """Devolve (campos, corpo) ou (None, texto) se não há frontmatter válido."""
    text = text.replace("\r\n", "\n")
    if not text.startswith("---\n"):
        return None, text
    end = text.find("\n---", 4)
    if end == -1:
        return None, text
    fields = {}
    for line in text[4:end].split("\n"):
        m = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if m:
            fields[m.group(1)] = m.group(2).strip().strip("\"'")
    body = text[end + 4 :].lstrip("\n")
    return fields, body


def check_skill(path: Path, tools: set) -> list:
    problems = []
    rel = f"{path.parent.name}/SKILL.md"
    fields, body = split_frontmatter(path.read_text(encoding="utf-8"))
    if fields is None:
        return [f"{rel}: sem frontmatter (--- ... ---)"]
    if fields.get("name") != path.parent.name:
        problems.append(f"{rel}: name '{fields.get('name')}' difere da pasta '{path.parent.name}'")
    desc = fields.get("description", "")
    if not desc:
        problems.append(f"{rel}: description vazia")
    elif len(desc) > MAX_DESCRIPTION:
        problems.append(f"{rel}: description com {len(desc)} caracteres (limite {MAX_DESCRIPTION})")
    lines = len(body.splitlines())
    if lines > MAX_BODY_LINES:
        problems.append(f"{rel}: corpo com {lines} linhas (limite {MAX_BODY_LINES})")
    for name in sorted(set(CITED_RE.findall(body))):
        if name not in tools and name not in NOT_TOOLS:
            problems.append(f"{rel}: tool `{name}` não existe no MCP")
    return problems


def check(skills_dir: Path, tools_dir: Path) -> list:
    tools = load_tools(tools_dir)
    if not tools:
        return [f"nenhuma tool encontrada em {tools_dir}"]
    problems = []
    for name in REMOVED_SKILLS:
        if (skills_dir / name).exists():
            problems.append(f"{name}: skill removida não pode existir em {skills_dir}")
    folders = sorted(p for p in skills_dir.glob("azm-*") if p.is_dir())
    if not folders:
        return [f"nenhuma pasta azm-* em {skills_dir}"]
    for folder in folders:
        skill = folder / "SKILL.md"
        if not skill.is_file():
            problems.append(f"{folder.name}: falta SKILL.md")
            continue
        problems.extend(check_skill(skill, tools))
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Valida as skills AZM.")
    ap.add_argument("--skills", type=Path, default=ROOT / "skills")
    ap.add_argument("--tools-dir", type=Path, default=ROOT / "apps" / "api" / "internal" / "mcp")
    args = ap.parse_args(argv)
    problems = check(args.skills, args.tools_dir)
    if problems:
        print("Skills inválidas:")
        for p in problems:
            print(f"  - {p}")
        return 1
    n = len(list(args.skills.glob("azm-*/SKILL.md")))
    print(f"{n} skills válidas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

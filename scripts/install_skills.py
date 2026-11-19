#!/usr/bin/env python3
"""Instala as skills AZM (skills/azm-*) onde o Claude Code as carrega.

Por padrão copia para ~/.claude/skills/; com --project, para .claude/skills/ do
repositório. Idempotente: substitui só as pastas azm-* e nunca toca em outras skills.
Só biblioteca padrão.

Uso: python scripts/install_skills.py [--project] [--link] [--dry-run]
"""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def source_skills(skills_dir: Path) -> list:
    return sorted(p for p in skills_dir.glob("azm-*") if (p / "SKILL.md").is_file())


def remove(target: Path) -> None:
    if target.is_symlink() or target.is_file():
        target.unlink()
    elif target.exists():
        shutil.rmtree(target)


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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Instala as skills AZM.")
    ap.add_argument("--project", action="store_true", help="instala em .claude/skills/ do repositório")
    ap.add_argument("--link", action="store_true", help="symlink em vez de cópia (no Windows pode exigir permissão)")
    ap.add_argument("--dry-run", action="store_true", help="só lista o que faria")
    ap.add_argument("--skills", type=Path, default=ROOT / "skills", help=argparse.SUPPRESS)
    ap.add_argument("--dest", type=Path, default=None, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    if args.dest is not None:
        dest = args.dest
    elif args.project:
        dest = ROOT / ".claude" / "skills"
    else:
        dest = Path.home() / ".claude" / "skills"

    if not source_skills(args.skills):
        print(f"nenhuma skill azm-* em {args.skills}", file=sys.stderr)
        return 1
    try:
        for line in install(args.skills, dest, link=args.link, dry_run=args.dry_run):
            print(line)
    except OSError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1
    if args.dry_run:
        print("(dry-run: nada foi gravado)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

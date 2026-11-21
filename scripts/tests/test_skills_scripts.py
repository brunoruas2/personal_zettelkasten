"""Testes de check_skills.py e install_skills.py. Rodar: python -m unittest discover scripts/tests"""
import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import check_skills  # noqa: E402
import install_skills  # noqa: E402

TOOLS_GO = 'Name: "read_zettel"\nName: "set_type"\nName: "edit_zettel"\n'


def skill(name="azm-x", description="Faz algo.", body="Use `read_zettel`.\n"):
    return f"---\nname: {name}\ndescription: {description}\n---\n\n{body}"


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.skills = self.tmp / "skills"
        self.tools = self.tmp / "mcp"
        self.tools.mkdir()
        (self.tools / "tools.go").write_text(TOOLS_GO, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def add(self, folder, content):
        d = self.skills / folder
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(content, encoding="utf-8")


class CheckSkills(Base):
    def run_check(self):
        return check_skills.check(self.skills, self.tools)

    def test_valida(self):
        self.add("azm-x", skill())
        self.assertEqual(self.run_check(), [])

    def test_nome_divergente(self):
        self.add("azm-x", skill(name="azm-y"))
        self.assertTrue(any("difere da pasta" in p for p in self.run_check()))

    def test_tool_inexistente(self):
        self.add("azm-x", skill(body="Chame `set_level` agora.\n"))
        problems = self.run_check()
        self.assertTrue(any("set_level" in p and "azm-x" in p for p in problems))

    def test_tool_com_argumentos_e_campos(self):
        self.add("azm-x", skill(body="`set_type(type: x)` e `old_string`, `counts_progress`.\n"))
        self.assertEqual(self.run_check(), [])

    def test_grande_demais(self):
        self.add("azm-x", skill(body="linha\n" * 201))
        self.assertTrue(any("201 linhas" in p for p in self.run_check()))

    def test_description_longa(self):
        self.add("azm-x", skill(description="a" * 1025))
        self.assertTrue(any("1025" in p for p in self.run_check()))

    def test_sem_frontmatter(self):
        self.add("azm-x", "só texto\n")
        self.assertTrue(any("frontmatter" in p for p in self.run_check()))

    def test_codigo_de_saida(self):
        self.add("azm-x", skill(body="`set_level`\n"))
        rc = check_skills.main(["--skills", str(self.skills), "--tools-dir", str(self.tools)])
        self.assertEqual(rc, 1)

    def test_pasta_removida_reaparece(self):
        self.add("azm-x", skill())
        for name in check_skills.REMOVED_SKILLS:
            self.add(name, skill(name=name))
            self.assertTrue(any(name in p and "removida" in p for p in self.run_check()), name)
            import shutil
            shutil.rmtree(self.skills / name)
        self.assertEqual(self.run_check(), [])

    def test_chaves_de_nivel_nao_sao_tools(self):
        self.add("azm-x", skill(body="Nivel `em-teste`, `iniciado`, `internalizado`.\n"))
        self.assertEqual(self.run_check(), [])

    def test_repo_real(self):
        """As skills versionadas passam na validação."""
        if not (check_skills.ROOT / "skills").is_dir():
            self.skipTest("sem skills/")
        self.assertEqual(check_skills.main([]), 0)


class InstallSkills(Base):
    def setUp(self):
        super().setUp()
        self.add("azm-a", skill(name="azm-a"))
        self.add("azm-b", skill(name="azm-b"))
        self.dest = self.tmp / "dest"

    def test_instala(self):
        install_skills.install(self.skills, self.dest)
        self.assertTrue((self.dest / "azm-a" / "SKILL.md").is_file())
        self.assertTrue((self.dest / "azm-b" / "SKILL.md").is_file())

    def test_reinstala_preservando_outras(self):
        other = self.dest / "outra"
        other.mkdir(parents=True)
        (other / "SKILL.md").write_text("minha", encoding="utf-8")
        install_skills.install(self.skills, self.dest)
        (self.dest / "azm-a" / "extra.txt").write_text("sobra", encoding="utf-8")
        install_skills.install(self.skills, self.dest)
        self.assertFalse((self.dest / "azm-a" / "extra.txt").exists())
        self.assertEqual((other / "SKILL.md").read_text(encoding="utf-8"), "minha")

    def test_dry_run_nao_grava(self):
        actions = install_skills.install(self.skills, self.dest, dry_run=True)
        self.assertEqual(len(actions), 2)
        self.assertFalse(self.dest.exists())

    def test_ignora_pasta_sem_skill_md(self):
        (self.skills / "azm-vazia").mkdir()
        (self.skills / "outra").mkdir()
        (self.skills / "outra" / "SKILL.md").write_text("x", encoding="utf-8")
        install_skills.install(self.skills, self.dest)
        self.assertFalse((self.dest / "azm-vazia").exists())
        self.assertFalse((self.dest / "outra").exists())

    # --- agente/harness, escopo, MCP, obsoletas ---

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = install_skills.main(["--skills", str(self.skills), "--dest", str(self.dest), *args])
        return rc, out.getvalue(), err.getvalue()

    def test_destino_por_agente_harness_escopo(self):
        root = Path("/repo")
        home = Path.home()
        self.assertEqual(install_skills.resolve_dest("claude", "cli", False, root), home / ".claude" / "skills")
        self.assertEqual(install_skills.resolve_dest("claude", "cli", True, root), root / ".claude" / "skills")
        for h in ("cli", "vscode"):
            self.assertEqual(install_skills.resolve_dest("copilot", h, False, root), home / ".copilot" / "skills")
            self.assertEqual(install_skills.resolve_dest("copilot", h, True, root), root / ".github" / "skills")

    def test_flags_completas_sem_prompt(self):
        with mock.patch("builtins.input", side_effect=AssertionError("não deveria perguntar")):
            rc, out, _ = self.run_main("--agent", "copilot", "--harness", "cli", "--yes")
        self.assertEqual(rc, 0)
        self.assertTrue((self.dest / "azm-a" / "SKILL.md").is_file())
        self.assertIn("mcpServers", out)

    def test_yes_usa_padroes_claude(self):
        rc, out, _ = self.run_main("--yes")
        self.assertEqual(rc, 0)
        self.assertIn("claude mcp add --transport http", out)

    def test_sem_tty_nao_bloqueia(self):
        # stdin de teste não é TTY: usa os padrões sem perguntar
        old = sys.stdin
        sys.stdin = io.StringIO("")
        try:
            rc, out, _ = self.run_main()
        finally:
            sys.stdin = old
        self.assertEqual(rc, 0)
        self.assertIn("claude mcp add", out)

    def test_agente_e_harness_desconhecidos(self):
        rc, _, err = self.run_main("--agent", "outro", "--yes")
        self.assertNotEqual(rc, 0)
        self.assertIn("claude", err)
        rc, _, err = self.run_main("--agent", "claude", "--harness", "xyz", "--yes")
        self.assertNotEqual(rc, 0)
        self.assertIn("cli", err)

    def test_dry_run_main_nao_grava_nem_remove(self):
        (self.dest / "azm-captura").mkdir(parents=True)
        rc, out, _ = self.run_main("--dry-run", "--yes")
        self.assertEqual(rc, 0)
        self.assertTrue((self.dest / "azm-captura").exists())
        self.assertFalse((self.dest / "azm-a").exists())
        self.assertIn("removeria (obsoleta)", out)

    def test_remove_so_obsoletas_conhecidas(self):
        for name in ("azm-captura", "azm-tutor", "azm-consolidar", "azm-minha-skill", "outra"):
            (self.dest / name).mkdir(parents=True)
        rc, out, _ = self.run_main("--yes")
        self.assertEqual(rc, 0)
        for name in install_skills.OBSOLETE:
            self.assertFalse((self.dest / name).exists())
            self.assertIn(name, out)
        self.assertTrue((self.dest / "azm-minha-skill").exists())
        self.assertTrue((self.dest / "outra").exists())
        self.assertIn("aviso: azm-minha-skill", out)

    def test_idempotente_main(self):
        self.run_main("--yes")
        rc, _, _ = self.run_main("--yes")
        self.assertEqual(rc, 0)
        self.assertTrue((self.dest / "azm-b" / "SKILL.md").is_file())

    def test_destino_nao_verificado_avisa(self):
        key = ("claude", "cli")
        old = install_skills.TARGETS[key]
        install_skills.TARGETS[key] = {**old, "verified": False}
        try:
            _, out, _ = self.run_main("--yes")
        finally:
            install_skills.TARGETS[key] = old
        self.assertIn("não verificado", out)

    def test_mcp_sem_chave_real(self):
        fake = "zk_" + "a" * 64
        old = os.environ.get("ZETTEL_API_KEY")
        os.environ["ZETTEL_API_KEY"] = fake
        try:
            outs = [self.run_main("--agent", a, "--harness", h, "--yes")[1]
                    for a, h in install_skills.TARGETS]
        finally:
            if old is None:
                del os.environ["ZETTEL_API_KEY"]
            else:
                os.environ["ZETTEL_API_KEY"] = old
        for out in outs:
            self.assertNotIn(fake, out)
        self.assertTrue(any("<SUA_CHAVE_zk_>" in o for o in outs))


if __name__ == "__main__":
    unittest.main()

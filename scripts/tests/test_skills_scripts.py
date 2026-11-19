"""Testes de check_skills.py e install_skills.py. Rodar: python -m unittest discover scripts/tests"""
import sys
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()

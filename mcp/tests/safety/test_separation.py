"""The separation rules from the plan, enforced in code.

1. mcp/ imports nothing from apps/, platform/ or deployment/ (only HTTP to Mission Control, and files).
2. learn/ and operate/ never import each other: a learner process has no code that can act on the lab.
3. operate/ has no shell, subprocess or Docker access; panel.py is its only door.
4. No machine-specific path is hard-coded.
"""
import ast
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src" / "lab_mcp"


def files(sub: str):
    return sorted((SRC / sub).rglob("*.py"))


def imports(path: Path) -> set[str]:
    out = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            out.add(("." * node.level) + mod)
    return out


def test_learn_never_imports_operate_and_operate_never_imports_learn():
    for f in files("learn"):
        assert not [i for i in imports(f) if "operate" in i], f
    for f in files("operate"):
        assert not [i for i in imports(f) if "learn" in i], f


def test_only_common_is_shared():
    for sub in ("learn", "operate"):
        for f in files(sub):
            internal = [i for i in imports(f) if i.startswith("lab_mcp")]
            assert all(i.startswith(("lab_mcp.common", "lab_mcp")) for i in internal), f
            assert not [i for i in internal if i.startswith(f"lab_mcp.{'operate' if sub == 'learn' else 'learn'}")], f


def test_operate_has_no_shell_subprocess_docker_or_file_writing():
    forbidden = {"subprocess", "os", "shutil", "pty", "docker", "pathlib"}
    for f in files("operate"):
        bad = [i for i in imports(f) if i.split(".")[0] in forbidden]
        assert not bad, f"{f.name} imports {bad}"
        text = f.read_text()
        assert not re.search(r"os\.system|Popen|check_output|(?<![A-Za-z0-9_.])open\(", text), f.name  # the builtin open(), not urlopen()


def test_learn_is_read_only_it_never_writes_files_or_runs_commands():
    for f in files("learn"):
        text = f.read_text()
        assert not re.search(r"subprocess|os\.system|Popen|shutil|\.write_text|\.write_bytes|open\([^)]*['\"][wa]", text), f.name
        assert not {i for i in imports(f) if i.split(".")[0] in {"subprocess", "shutil", "urllib", "http", "socket", "requests"}}, f.name


def test_the_panel_client_is_operates_only_network_code():
    users = [f.name for f in files("operate") if {i for i in imports(f) if i.startswith(("urllib", "http", "socket"))}]
    assert users == ["panel.py"]


def test_nothing_from_the_lab_is_imported_and_no_machine_path_is_hard_coded():
    for f in files(""):
        assert not [i for i in imports(f) if i.split(".")[0] in {"apps", "platform", "deployment"}], f
        assert "/Users/" not in f.read_text() and "/home/" not in f.read_text(), f.name

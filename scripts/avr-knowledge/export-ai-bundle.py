#!/usr/bin/env python3
"""Export committed AI materials without reading the working tree or server state.

Usage: python scripts/avr-knowledge/export-ai-bundle.py --ref HEAD --output /outside/repo/ai.zip
Check: python scripts/avr-knowledge/export-ai-bundle.py --self-test
Python 3.10+ and Git are required; no third-party packages or network access.
"""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import zipfile


ROOT_FILES = {"LICENSE", "NOTICE", "backend/package.json", "backend/package-lock.json", "backend/AI-SETUP.md"}
TREES = ("backend/ai/", "backend/deploy/", "public/avr-mini-projects/", "scripts/avr-knowledge/")
EXCLUDED_PARTS = {
    ".git", "__pycache__", "node_modules", "draft", "drafts", "live", "cache", "caches",
    "tmp", "temp", "log", "logs", "secret", "secrets", "private", "credentials",
    "db", "database", "databases",
}
EXCLUDED_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".log", ".pem", ".key", ".p12", ".pfx", ".pyc"}


def git(repo, *arguments):
    result = subprocess.run(["git", "-C", str(repo), *arguments], capture_output=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def allowed(path):
    parts = PurePosixPath(path).parts
    if not parts or path.startswith("/") or any(p in {".", ".."} for p in parts):
        return False
    if "\\" in path or any(ord(c) < 32 or ord(c) == 127 for c in path):
        return False
    lower = [p.lower() for p in parts]
    filename = lower[-1]
    if any(p in EXCLUDED_PARTS for p in lower):
        return False
    if filename.startswith(".env") or filename in {"id_rsa", "id_ed25519", "credentials.json", "secrets.json"}:
        return False
    if PurePosixPath(filename).suffix in EXCLUDED_SUFFIXES:
        return False
    if path.startswith("backend/ai/") and filename.endswith(".zip"):
        return False  # An imported colleague archive is not a deployed knowledge source.
    return (
        path in ROOT_FILES
        or (len(parts) == 2 and parts[0] == "backend" and filename.endswith(".js"))
        or path.startswith(TREES)
        or (len(parts) == 2 and parts[0] == "docs" and parts[1].startswith("AVR") and filename.endswith(".md"))
    )


def source_entries(repo, commit):
    entries = {}
    tree = git(repo, "ls-tree", "-r", "-z", "--full-tree", commit, "--",
               "LICENSE", "NOTICE", "backend", "public/avr-mini-projects", "scripts/avr-knowledge", "docs")
    for record in tree.split(b"\0"):
        if not record:
            continue
        header, raw_path = record.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split()
        path = raw_path.decode("utf-8")
        if mode not in {"100644", "100755"} or kind != "blob" or not allowed(path):
            continue
        # Read the immutable blob, never the corresponding filesystem path.
        entries[path] = (git(repo, "cat-file", "blob", oid), int(mode, 8))
    if not entries:
        raise ValueError("No allowlisted regular files exist at this commit.")
    return entries


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def metadata(entries, commit, timestamp):
    bundles = []
    tools = []
    for path, (data, _) in sorted(entries.items()):
        if path.startswith("backend/ai/knowledge/") and path.endswith("/manifest.json"):
            value = json.loads(data)
            bundles.append({"path": path, "id": value.get("id"), "version": value.get("version"),
                            "recipes": [r.get("id") for r in value.get("recipes", [])]})
        if path.startswith("backend/ai/knowledge/") and path.endswith("compiler-evidence.json"):
            value = json.loads(data)
            observation = value.get("environmentObservation", {})
            tools.append({"path": path, "compilerVersion": observation.get("compilerVersion"),
                          "installedDfpVersion": observation.get("installedDfpVersion")})
        if path.startswith("backend/ai/knowledge/") and path.endswith("/reference/dfp-registers.json"):
            value = json.loads(data)
            tools.append({"path": path, "sourceDfp": value.get("sourceId")})
    service = entries.get("backend/avr-ai-service.js", (b"", 0))[0].decode("utf-8")
    match = re.search(r'packageId\s*:\s*["\'](uartdebug-canvas-[^"\']+)["\']', service)
    rules = entries.get("backend/ai/canvas-rules.md", (b"", 0))[0]
    package = json.loads(entries.get("backend/package.json", (b"{}", 0))[0])
    return {
        "formatVersion": 1,
        "commit": commit,
        "commitTimeUtc": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
        "knowledgeBundles": bundles,
        "rulesPack": {"packageId": match.group(1) if match else None,
                      "sha256": sha256(rules) if rules else None},
        "toolchains": tools,
        "nodeRequirement": package.get("engines", {}).get("node"),
        "extractionRequirements": entries.get("scripts/avr-knowledge/requirements.txt", (b"", 0))[0].decode("utf-8"),
        "sourceFileCount": len(entries),
        "sourceSelection": "Regular Git blobs at this commit, explicit path allowlist; no working-tree/server reads",
        "zipMethod": "stored; sorted names; normalized permissions; UTC commit timestamp rounded to ZIP two-second precision",
    }


def readme(info):
    versions = ", ".join(str(v.get("version")) for v in info["knowledgeBundles"]) or "не обнаружены"
    return f"""# Материалы ИИ UartDebug

Архив содержит исходные материалы из одного зафиксированного состояния Git.
Commit: `{info['commit']}`; время commit (UTC): {info['commitTimeUtc']}.
Версии базы: **{versions}**. Пакет правил: `{info['rulesPack']['packageId']}`.
SHA256 правил: `{info['rulesPack']['sha256']}`.

Это архив исходников, а не резервная копия сервера. Его создание не подтверждает
развёртывание этого commit. Чтобы связать ZIP с работающим сервером, сравните commit
и версии с опубликованным результатом проверки релиза.

Включены: JS в корне backend, его package.json/package-lock.json и AI-SETUP.md;
backend/ai (правила, рецепты, официальные PDF/DFP, обработанные данные, проверенные
факты и результаты компиляции); публичные deploy helpers; полные учебные проекты
public/avr-mini-projects; scripts/avr-knowledge; docs/AVR*.md; корневые LICENSE и
NOTICE, если они есть в выбранном commit. Другие корневые файлы не включаются.

Исключены: незакоммиченные изменения и файлы, секретные/env-файлы, ключи,
базы данных, node_modules, журналы, live/cache/tmp/draft каталоги и символические
ссылки. Оригинальный ZIP коллеги не является материалом сервера и не включается;
включаются только отобранные и зафиксированные в базе материалы.

Точные версии компилятора, установленного DFP, справочного DFP, Node и инструментов
извлечения перечислены в BUNDLE_MANIFEST.json и исходных compiler-evidence.json.
Отсутствующее значение означает отсутствие сведений в этом commit, а не проверку.
Компиляция примера не подтверждает аппаратную проверку или любой будущий код.
Официальные источники сохраняют собственные лицензии и уведомления об авторских правах.

SHA256SUMS содержит SHA-256 каждого исходного файла, README_RU.md и
BUNDLE_MANIFEST.json. Сам SHA256SUMS исключён из своего списка; хеш всего ZIP,
включая этот список, печатает команда экспорта. Проверка на Linux: `sha256sum -c SHA256SUMS`.
ZIP хранит стандартные файлы без специальных расширений и открывается обычным
архиватором телефона. Начните с docs/AVR_AI_UPDATE_REPORT_RU.md, затем с рецептов
в backend/ai/knowledge и учебных проектов в public/avr-mini-projects.

Повторный экспорт (путь назначения должен находиться вне репозитория и не существовать):
`python scripts/avr-knowledge/export-ai-bundle.py --ref {info['commit']} --output /outside/repo/uartdebug-ai.zip`
Проверка экспортера: `python scripts/avr-knowledge/export-ai-bundle.py --self-test`.
ZIP использует несжатые записи: порядок, байты, права и даты воспроизводимы без
зависимости от версии библиотеки сжатия. Данные читаются только из Git-объектов.
""".encode("utf-8")


def export_bundle(repo, ref, output):
    repo = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    output = Path(output).expanduser().resolve()
    if output.is_relative_to(repo):
        raise ValueError("--output must be outside the repository.")
    if output.suffix.lower() != ".zip":
        raise ValueError("--output must name a .zip file.")
    if output.exists():
        raise ValueError("Refusing to overwrite an existing output file.")
    commit = git(repo, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}").decode().strip()
    timestamp = int(git(repo, "show", "-s", "--format=%ct", commit))
    entries = source_entries(repo, commit)
    info = metadata(entries, commit, timestamp)
    entries["README_RU.md"] = (readme(info), 0o100644)
    entries["BUNDLE_MANIFEST.json"] = ((json.dumps(info, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(), 0o100644)
    sums = "".join(f"{sha256(data)}  {path}\n" for path, (data, _) in sorted(entries.items()))
    entries["SHA256SUMS"] = (sums.encode("utf-8"), 0o100644)
    date = datetime.fromtimestamp(timestamp, timezone.utc)
    if not 1980 <= date.year <= 2107:
        date = datetime(1980, 1, 1, tzinfo=timezone.utc)
    zip_time = (date.year, date.month, date.day, date.hour, date.minute, date.second // 2 * 2)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for path, (data, mode) in sorted(entries.items()):
            entry = zipfile.ZipInfo(path, date_time=zip_time)
            entry.create_system = 3
            entry.external_attr = mode << 16
            archive.writestr(entry, data)
    return {"output": str(output), "commit": commit, "files": len(entries),
            "bytes": output.stat().st_size, "sha256": sha256(output.read_bytes())}


def self_test():
    with tempfile.TemporaryDirectory(prefix="uartdebug-ai-export-test-") as temporary:
        root = Path(temporary)
        repo = root / "repo"
        repo.mkdir()
        git(repo, "init", "-q")
        sources = {"LICENSE": b"application license\n", "NOTICE": b"notice\n", "OTHER.txt": b"not allowed\n",
                   "backend/main.js": b"committed\n", "backend/ai/canvas-rules.md": b"rules\n",
                   "public/avr-mini-projects/01/example.c": b"int main(void) {}\n",
                   "backend/deploy/example.sh": b"#!/bin/sh\n", "docs/AVR_TEST.md": b"report\n",
                   "backend/ai/live/job.json": b"private live data", "backend/ai/.env": b"test secret",
                   "backend/ai/cache/data.json": b"cache", "backend/ai/drafts/note.md": b"draft",
                   "backend/ai/access.sqlite": b"database", "backend/ai/colleague.zip": b"archive",
                   "backend/unrelated.txt": b"outside allowlist"}
        for path, data in sources.items():
            target = repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        git(repo, "add", "--", ".")
        # Add a tracked symlink without needing Windows symlink privileges.
        link_blob = git(repo, "hash-object", "-w", "--", "backend/main.js").decode().strip()
        git(repo, "update-index", "--add", "--cacheinfo", "120000," + link_blob + ",backend/ai/link.md")
        git(repo, "-c", "user.name=Export Test", "-c", "user.email=export-test@example.invalid",
            "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + str(root / "no-hooks"),
            "commit", "-qm", "synthetic export test")
        (repo / "backend/main.js").write_bytes(b"uncommitted change")
        (repo / "backend/ai/untracked.md").write_bytes(b"not committed")
        first = export_bundle(repo, "HEAD", root / "first.zip")
        second = export_bundle(repo, "HEAD", root / "second.zip")
        assert first["sha256"] == second["sha256"], "ZIP bytes are not deterministic"
        with zipfile.ZipFile(root / "first.zip") as archive:
            assert archive.testzip() is None
            assert archive.read("backend/main.js") == b"committed\n"
            expected = {"LICENSE", "NOTICE", "backend/main.js", "backend/ai/canvas-rules.md",
                        "public/avr-mini-projects/01/example.c", "backend/deploy/example.sh", "docs/AVR_TEST.md",
                        "README_RU.md", "BUNDLE_MANIFEST.json", "SHA256SUMS"}
            assert set(archive.namelist()) == expected
            checked = set()
            for line in archive.read("SHA256SUMS").decode().splitlines():
                digest, path = line.split("  ", 1)
                assert sha256(archive.read(path)) == digest, path
                checked.add(path)
            assert checked == expected - {"SHA256SUMS"}
        for invalid in (repo / "inside.zip", root / "first.zip"):
            try:
                export_bundle(repo, "HEAD", invalid)
            except ValueError:
                pass
            else:
                raise AssertionError("Unsafe output was accepted")
    print("Self-test passed: committed bytes, allowlist/exclusions, reproducibility, ZIP CRC, SHA-256 coverage, output guards.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="Committed Git ref (default: HEAD)")
    parser.add_argument("--output", type=Path, help="New ZIP path outside the repository")
    parser.add_argument("--self-test", action="store_true", help="Run isolated synthetic Git/export checks")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.output is None:
        parser.error("--output is required unless --self-test is used")
    try:
        result = export_bundle(Path(__file__).resolve().parents[2], args.ref, args.output)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Export failed: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

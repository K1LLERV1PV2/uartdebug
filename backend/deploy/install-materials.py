"""Install an immutable Git archive without executing any repository content."""

import argparse
import hashlib
try:
    import fcntl
except ImportError:  # Preparing a local snapshot on a Windows development PC.
    fcntl = None
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile

REPOSITORY = "Sergey-Bulanov/UartDebug2"
REQUIRED = (
    "AGENTS.md",
    "Project_Rules/AGENTS_Add_On.md",
    "Project_Rules/Project_Description.md",
    "Project_Rules/Base_project_rules.md",
    "MCU_Knowledge_Base/00_README.md",
    "MCU_Knowledge_Base/AVR/00_README.md",
    "MCU_Knowledge_Base/AVR/AVR_Programming_General_Rules.md",
)
MAX_FILES = 10_000
MAX_BYTES = 512 * 1024 * 1024


def safe_path(name):
    path = PurePosixPath(name)
    if (not name or "\\" in name or "\0" in name or path.is_absolute()
            or any(part in (".", "..", ".git") for part in name.split("/"))
            or re.match(r"^[A-Za-z]:", name)):
        raise ValueError("The archive contains an unsafe path")
    return path


def verify_existing(release, manifest):
    existing = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
    if existing["files"] != manifest["files"] or existing["commit"] != manifest["commit"]:
        raise ValueError("The commit already exists with different content")
    root = release / "repository"
    if root.is_symlink() or not root.is_dir():
        raise ValueError("The installed repository root is invalid")
    paths = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
    if paths != set(manifest["files"]):
        raise ValueError("The installed file set is invalid")
    for name, record in manifest["files"].items():
        path = root / name
        if path.is_symlink() or path.stat().st_size != record["bytes"]:
            raise ValueError("The installed file is invalid")
        if hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("The installed file digest is invalid")


def install(archive_path, materials_root, commit, run_id=None, run_attempt=None, validator=None, activate=True):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("A full Git commit is required")
    root = Path(materials_root).resolve()
    if os.name == "nt" and not str(root).startswith("\\\\?\\"):
        root = Path("\\\\?\\" + str(root))
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / "install.lock").open("a")
    if fcntl:
        fcntl.flock(lock, fcntl.LOCK_EX)
    elif activate:
        lock.close()
        raise ValueError("Activation requires a Linux deployment host; use --no-activate to prepare a local snapshot")
    releases = root / "releases"
    releases.mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".incoming-", dir=releases))
    try:
        repository = stage / "repository"
        repository.mkdir()
        records = {}
        seen = set()
        total = 0
        with tarfile.open(archive_path, "r:gz") as archive:
            if archive.pax_headers.get("comment") != commit:
                raise ValueError("The Git archive does not match the authenticated commit")
            for member in archive:
                name = member.name.rstrip("/")
                path = safe_path(name)
                if name in seen:
                    raise ValueError("The archive contains duplicate entries")
                seen.add(name)
                if len(seen) > MAX_FILES:
                    raise ValueError("The archive contains too many entries")
                target = repository.joinpath(*path.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile() or member.size < 0:
                    raise ValueError("Only regular repository files are accepted")
                total += member.size
                if total > MAX_BYTES:
                    raise ValueError("The repository exceeds the expanded size limit")
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                count = 0
                stream = archive.extractfile(member)
                with stream, target.open("xb") as output:
                    while chunk := stream.read(1024 * 1024):
                        count += len(chunk)
                        digest.update(chunk)
                        output.write(chunk)
                if count != member.size:
                    raise ValueError("The archive is incomplete")
                target.chmod(0o640)
                records[name] = {"sha256": digest.hexdigest(), "bytes": count}
        for name in REQUIRED:
            if name not in records or not records[name]["bytes"]:
                raise ValueError(f"The required materials file is missing: {name}")
            (repository / name).read_text(encoding="utf-8")
        manifest = {
            "schemaVersion": 1, "repository": REPOSITORY, "commit": commit,
            "files": dict(sorted(records.items())),
        }
        if run_id is not None:
            manifest["deployment"] = {"runId": str(run_id), "runAttempt": str(run_attempt)}
        (stage / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for path in stage.rglob("*"):
            if path.is_dir():
                path.chmod(0o750)
        stage.chmod(0o750)
        (stage / "manifest.json").chmod(0o640)
        if validator:
            subprocess.run(["node", str(validator), str(repository)], check=True,
                           capture_output=True, text=True, timeout=60)
        release = releases / commit
        if release.exists():
            verify_existing(release, manifest)
        else:
            stage.rename(release)
        result = {"ok": True, "repository": REPOSITORY, "commit": commit,
                  "files": len(records), "bytes": total, "root": str(release / "repository")}
        if not activate:
            return result
        current = root / "current"
        if current.exists() and not current.is_symlink():
            raise ValueError("The active materials path must be a release symlink")
        if run_id is not None:
            state_file = root / "activation.json"
            previous = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
            previous_order = (int(previous.get("runId", 0)), int(previous.get("runAttempt", 0)))
            requested_order = (int(run_id), int(run_attempt))
            if previous_order > requested_order:
                raise ValueError("An older workflow cannot replace newer materials")
            if previous_order == requested_order and previous.get("commit", commit) != commit:
                raise ValueError("A workflow run cannot activate two different commits")
            state_temporary = root / f".activation-{os.getpid()}.json"
            with state_temporary.open("w", encoding="utf-8") as stream:
                json.dump({"runId": str(run_id), "runAttempt": str(run_attempt), "commit": commit}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            state_temporary.chmod(0o640)
            state_temporary.replace(state_file)
        temporary_link = root / f".current-{commit}-{os.getpid()}"
        temporary_link.symlink_to(Path("releases") / commit, target_is_directory=True)
        temporary_link.replace(current)
        return result
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--run-id")
    parser.add_argument("--run-attempt", default="1")
    parser.add_argument("--validator")
    parser.add_argument("--no-activate", action="store_true", help="Prepare an immutable local snapshot without switching the active release")
    args = parser.parse_args()
    try:
        result = install(args.archive, args.root, args.commit, args.run_id, args.run_attempt, args.validator, not args.no_activate)
    except (ValueError, OSError, tarfile.TarError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
    print(json.dumps(result))


if __name__ == "__main__":
    main()

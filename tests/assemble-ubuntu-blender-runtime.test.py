#!/usr/bin/env python3
"""Focused offline tests for the Ubuntu candidate rootfs assembler."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest


REPOSITORY = Path(__file__).resolve().parents[1]
SCRIPT = REPOSITORY / "scripts" / "assemble-ubuntu-blender-runtime.py"

spec = importlib.util.spec_from_file_location("ubuntu_assembler", SCRIPT)
assert spec and spec.loader
assembler = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = assembler
spec.loader.exec_module(assembler)


def ar_member(name: str, data: bytes) -> bytes:
    encoded = (
        f"{name:<16}{0:<12}{0:<6}{0:<6}{0o100644:<8}{len(data):<10}`\n".encode("ascii")
    )
    assert len(encoded) == 60
    return encoded + data + (b"\n" if len(data) % 2 else b"")


def tar_bytes(members: list[dict]) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for value in members:
            info = tarfile.TarInfo(value["path"])
            info.mode = value.get("mode", 0o644)
            kind = value.get("kind", "file")
            if kind == "directory":
                info.type = tarfile.DIRTYPE
                info.mode = value.get("mode", 0o755)
                archive.addfile(info)
            elif kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = value["target"]
                archive.addfile(info)
            elif kind == "hardlink":
                info.type = tarfile.LNKTYPE
                info.linkname = value["target"]
                archive.addfile(info)
            else:
                payload = value.get("data", b"")
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
    return stream.getvalue()


def write_deb(cache: Path, name: str, version: str, architecture: str, members: list[dict], filename: str | None = None) -> Path:
    filename = filename or f"pool/main/{name[0]}/{name}/{name}_{version}_{architecture}.deb"
    path = cache / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    control = (
        f"Package: {name}\nVersion: {version}\nArchitecture: {architecture}\n"
        "Description: synthetic test payload\n"
    ).encode("utf-8")
    control_tar = tar_bytes([{"path": "./control", "data": control}])
    data_tar = tar_bytes(members)
    payload = b"!<arch>\n" + ar_member("debian-binary", b"2.0\n") + ar_member("control.tar.gz", control_tar) + ar_member("data.tar.gz", data_tar)
    path.write_bytes(payload)
    return path


def lock_for(archives: list[tuple[Path, str, str, str]]) -> dict:
    packages = []
    for path, name, version, architecture in archives:
        relative = path.relative_to(path.parents[4]).as_posix()
        packages.append(
            {
                "name": name,
                "version": version,
                "architecture": architecture,
                "filename": relative,
                "size": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "source": {"name": name, "version": version, "component": "main"},
            }
        )
    return {
        "schema": "orbsie.ubuntu-blender-dependency-lock/v1",
        "status": "candidate",
        "distribution": {"suite": "noble", "codename": "noble", "architecture": "amd64"},
        "packages": packages,
    }


class UbuntuRuntimeAssemblyTests(unittest.TestCase):
    def run_assembler(self, lock: Path, cache: Path, output: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/usr/bin/python3", str(SCRIPT), str(lock), str(cache), str(output)],
            cwd=REPOSITORY,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    def package(self, root: Path, name: str = "synthetic-runtime", version: str = "1.0", members: list[dict] | None = None) -> tuple[Path, str, str, str]:
        cache = root / "cache"
        members = members or [
            {"path": "./usr", "kind": "directory"},
            {"path": "./usr/bin", "kind": "directory"},
            {"path": "./usr/share", "kind": "directory"},
            {"path": "./usr/share/doc", "kind": "directory"},
            {"path": "./usr/share/doc/copyright", "data": b"copyright\n"},
            {"path": "./etc", "kind": "directory"},
        ]
        path = write_deb(cache, name, version, "amd64", members)
        return path, name, version, "amd64"

    def write_lock(self, root: Path, archives: list[tuple[Path, str, str, str]]) -> Path:
        lock = root / "lock.json"
        lock.write_text(json.dumps(lock_for(archives), indent=2) + "\n", encoding="utf-8")
        return lock

    def test_valid_payload_normalizes_absolute_symlink_and_records_candidate_manifest(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-assembly-test-") as temporary:
            root = Path(temporary)
            package = self.package(
                root,
                members=[
                    # Omit parent directory members deliberately: the assembler
                    # must create safe implied parents before regular files and links.
                    {"path": "./usr/share/doc/copyright", "data": b"copyright\n"},
                    {"path": "./etc/copyright", "kind": "symlink", "target": "/usr/share/doc/copyright"},
                ],
            )
            lock = self.write_lock(root, [package])
            output = root / "candidate"
            result = self.run_assembler(lock, root / "cache", output)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["schema"], "orbsie.ubuntu-blender-runtime/v1")
            self.assertEqual(manifest["status"], "candidate")
            self.assertFalse(manifest["releaseCertified"])
            self.assertTrue((output / "usr/share/doc/copyright").read_bytes() == b"copyright\n")
            self.assertEqual((output / "etc/copyright").readlink().as_posix(), "../usr/share/doc/copyright")
            self.assertEqual((output / "bin").readlink().as_posix(), "usr/bin")
            self.assertEqual((output / "lib64").readlink().as_posix(), "usr/lib64")
            changes = manifest["generated"]["symlinkNormalizations"]
            self.assertEqual(changes[0]["from"], "/usr/share/doc/copyright")
            self.assertEqual(changes[0]["to"], "../usr/share/doc/copyright")
            self.assertGreater(manifest["integrity"]["entryCount"], 0)

    def test_hash_mismatch_rejects_before_creating_output(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-assembly-test-") as temporary:
            root = Path(temporary)
            package = self.package(root)
            lock = self.write_lock(root, [package])
            value = json.loads(lock.read_text(encoding="utf-8"))
            value["packages"][0]["sha256"] = "0" * 64
            lock.write_text(json.dumps(value) + "\n", encoding="utf-8")
            output = root / "candidate"
            result = self.run_assembler(lock, root / "cache", output)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            self.assertIn("SHA-256 mismatch", result.stderr)

    def test_archive_path_traversal_is_rejected_without_output(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-assembly-test-") as temporary:
            root = Path(temporary)
            package = self.package(root, members=[{"path": "../../escape", "data": b"bad"}])
            lock = self.write_lock(root, [package])
            output = root / "candidate"
            result = self.run_assembler(lock, root / "cache", output)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            self.assertIn("traversal", result.stderr)

    def test_symlink_escape_is_rejected_without_output(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-assembly-test-") as temporary:
            root = Path(temporary)
            package = self.package(
                root,
                members=[
                    {"path": "./usr", "kind": "directory"},
                    {"path": "./usr/bin", "kind": "directory"},
                    {"path": "./usr/bin/escape", "kind": "symlink", "target": "../../../../outside"},
                ],
            )
            lock = self.write_lock(root, [package])
            output = root / "candidate"
            result = self.run_assembler(lock, root / "cache", output)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            self.assertIn("escapes root", result.stderr)

    def test_conflicting_payload_paths_are_rejected_without_output(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-assembly-test-") as temporary:
            root = Path(temporary)
            first = self.package(
                root,
                name="first-payload",
                members=[{"path": "./usr", "kind": "directory"}, {"path": "./usr/shared", "kind": "directory"}, {"path": "./usr/shared/value", "data": b"one"}],
            )
            second = self.package(
                root,
                name="second-payload",
                members=[{"path": "./usr", "kind": "directory"}, {"path": "./usr/shared", "kind": "directory"}, {"path": "./usr/shared/value", "data": b"two"}],
            )
            lock = self.write_lock(root, [first, second])
            output = root / "candidate"
            result = self.run_assembler(lock, root / "cache", output)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            self.assertIn("conflicting package payload path", result.stderr)

    def test_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-assembly-test-") as temporary:
            root = Path(temporary)
            package = self.package(root)
            lock = self.write_lock(root, [package])
            output = root / "candidate"
            output.mkdir()
            sentinel = output / "sentinel"
            sentinel.write_text("keep", encoding="utf-8")
            result = self.run_assembler(lock, root / "cache", output)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main(verbosity=2)

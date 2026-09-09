#!/usr/bin/env python3
"""Focused offline tests for the Ubuntu dependency lock command."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPOSITORY = Path(__file__).resolve().parents[1]
SCRIPT = REPOSITORY / "scripts" / "lock-ubuntu-blender-runtime.py"
INPUT = Path(
    os.environ.get(
        "ORBSIE_UBUNTU_LOCK_INPUT",
        "/home/marcos/.cache/orbsie-runtime/noble-4.0.2",
    )
)
INPUT_FILES = (
    "InRelease",
    "main-Packages",
    "Packages",
    "main-Sources.xz",
    "Sources.xz",
)


class UbuntuDependencyLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not all((INPUT / name).is_file() for name in INPUT_FILES):
            raise unittest.SkipTest(f"offline Ubuntu input cache is absent: {INPUT}")

    def run_lock(self, input_dir: Path, output: Path, env=None):
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        return subprocess.run(
            ["/usr/bin/python3", str(SCRIPT), str(input_dir), str(output)],
            cwd=REPOSITORY,
            env=merged_env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )

    def link_cache(self, directory: Path, *, include=INPUT_FILES):
        directory.mkdir()
        for name in include:
            if name == "InRelease":
                shutil.copy2(INPUT / name, directory / name)
            else:
                try:
                    os.link(INPUT / name, directory / name)
                except OSError:
                    shutil.copy2(INPUT / name, directory / name)

    def test_valid_lock_is_deterministic_and_records_signed_package_fields(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-lock-test-") as temp:
            directory = Path(temp)
            first = directory / "first.json"
            second = directory / "second.json"
            result = self.run_lock(INPUT, first)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = self.run_lock(INPUT, second)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(first.read_bytes(), second.read_bytes())

            lock = json.loads(first.read_text())
            self.assertEqual(lock["schema"], "orbsie.ubuntu-blender-dependency-lock/v1")
            self.assertEqual(lock["status"], "candidate")
            self.assertEqual(lock["resolver"]["engine"], "apt_pkg")
            self.assertEqual(lock["resolver"]["installedStatus"], "empty")
            self.assertFalse(lock["resolver"]["installRecommends"])
            self.assertFalse(lock["resolver"]["installSuggests"])
            self.assertGreater(lock["resolver"]["selectedCount"], 300)
            self.assertEqual(
                set(lock["resolver"]["roots"]),
                {"blender", "python3-numpy", "python3", "bubblewrap", "util-linux"},
            )
            self.assertEqual(
                lock["resolver"]["roots"]["blender"],
                "4.0.2+dfsg-1ubuntu8",
            )
            self.assertEqual(len(lock["packages"]), lock["resolver"]["selectedCount"])
            for package in lock["packages"]:
                self.assertRegex(package["sha256"], r"^[0-9a-f]{64}$")
                self.assertGreaterEqual(package["size"], 0)
                self.assertIn(package["architecture"], {"amd64", "all"})
                self.assertTrue(package["filename"].startswith("pool/"))
                self.assertEqual(
                    set(package["source"]),
                    {"name", "version", "component"},
                )

    def test_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-lock-test-") as temp:
            output = Path(temp) / "lock.json"
            first = self.run_lock(INPUT, output)
            self.assertEqual(first.returncode, 0, first.stderr)
            before = output.read_bytes()
            second = self.run_lock(INPUT, output)
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("output exists", second.stderr)
            self.assertEqual(output.read_bytes(), before)

    def test_modified_signed_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-lock-test-") as temp:
            directory = Path(temp) / "input"
            self.link_cache(directory)
            release = directory / "InRelease"
            contents = release.read_bytes()
            marker = b"Date: Thu, 25 Apr 2024"
            self.assertIn(marker, contents)
            release.write_bytes(contents.replace(marker, b"Date: Fri, 26 Apr 2024", 1))
            result = self.run_lock(directory, Path(temp) / "lock.json")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("signature", result.stderr.lower())

    def test_missing_signed_index_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-lock-test-") as temp:
            directory = Path(temp) / "input"
            self.link_cache(
                directory,
                include=(
                    "InRelease",
                    "Packages",
                    "main-Sources.xz",
                    "Sources.xz",
                ),
            )
            result = self.run_lock(directory, Path(temp) / "lock.json")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("main-Packages", result.stderr)

    def test_host_apt_config_cannot_change_the_private_solver(self):
        with tempfile.TemporaryDirectory(prefix="orbsie-lock-test-") as temp:
            hostile_config = Path(temp) / "host-apt.conf"
            hostile_config.write_text(
                'APT::Architecture "i386";\n'
                'APT::Install-Recommends "true";\n'
                'Dir::Etc::sourcelist "/etc/apt/sources.list";\n'
                'Dir::State::status "/var/lib/dpkg/status";\n',
                encoding="utf-8",
            )
            result = self.run_lock(
                INPUT,
                Path(temp) / "lock.json",
                {"APT_CONFIG": str(hostile_config)},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            lock = json.loads((Path(temp) / "lock.json").read_text())
            self.assertEqual(lock["resolver"]["architecture"], "amd64")
            self.assertFalse(lock["resolver"]["installRecommends"])
            self.assertEqual(
                lock["resolver"]["roots"]["blender"],
                "4.0.2+dfsg-1ubuntu8",
            )


if __name__ == "__main__":
    unittest.main()

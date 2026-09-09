#!/usr/bin/env python3
"""Create an offline, signed-index-backed Ubuntu Blender dependency lock.

This command never runs apt update, downloads archives, consults the host
dpkg status database, or installs packages. It feeds only the explicitly
provided Noble main/universe indexes to apt_pkg with an empty status file.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
from typing import Iterable, Iterator

try:
    import apt_pkg
except ModuleNotFoundError as error:  # pragma: no cover - exercised on non-Ubuntu hosts
    raise SystemExit(
        "lock-ubuntu-blender-runtime.py requires /usr/bin/python3 with apt_pkg"
    ) from error


VERSION = "4.0.2+dfsg-1ubuntu8"
SUITE = "noble"
ARCHITECTURE = "amd64"
SIGNER = "F6ECB3762474EDA9D21B7022871920D1991BC93C"
SCHEMA = "orbsie.ubuntu-blender-dependency-lock/v1"

ROOTS = (
    ("blender", VERSION),
    ("python3-numpy", None),
    ("python3", None),
    ("bubblewrap", None),
    ("util-linux", None),
)

INDEXES = (
    ("main-Packages", "main/binary-amd64/Packages", "main", False),
    ("Packages", "universe/binary-amd64/Packages", "universe", False),
    ("main-Sources.xz", "main/source/Sources.xz", "main", True),
    ("Sources.xz", "universe/source/Sources.xz", "universe", True),
)


class LockError(ValueError):
    """A user-input, signature, index, or resolver failure."""


def fail(message: str) -> None:
    raise LockError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def require_regular_file(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        fail(f"{label} is missing: {path}")
    except OSError as error:
        fail(f"cannot inspect {label} {path}: {error}")
    require(stat.S_ISREG(info.st_mode), f"{label} is not a regular file: {path}")
    require(not stat.S_ISLNK(info.st_mode), f"{label} must not be a symlink: {path}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_paragraphs(lines: Iterable[str]) -> Iterator[dict[str, str]]:
    current: dict[str, str] = {}
    key: str | None = None
    for raw_line in lines:
        line = raw_line.rstrip("\r\n")
        if not line.strip():
            if current:
                yield current
                current = {}
                key = None
            continue
        if line.startswith((" ", "\t")):
            require(key is not None, "continuation line has no preceding field")
            current[key] += "\n" + line.strip()
            continue
        require(":" in line, f"malformed metadata line: {line[:120]}")
        field, value = line.split(":", 1)
        require(field and field not in current, f"duplicate metadata field: {field}")
        current[field] = value.strip()
        key = field
    if current:
        yield current


def parse_text_record(text: str, label: str) -> dict[str, str]:
    records = list(parse_paragraphs(io.StringIO(text)))
    require(len(records) == 1, f"{label} must contain one metadata record")
    return records[0]


def parse_sha256_field(value: str, label: str) -> dict[str, tuple[int, str]]:
    result: dict[str, tuple[int, str]] = {}
    for line in value.splitlines():
        if not line.strip():
            continue
        parts = line.split()
        require(len(parts) == 3, f"malformed SHA256 entry in {label}: {line}")
        digest, size_text, filename = parts
        require(
            re.fullmatch(r"[0-9a-fA-F]{64}", digest) is not None,
            f"invalid SHA256 digest in {label}: {digest}",
        )
        try:
            size = int(size_text)
        except ValueError as error:
            raise LockError(f"invalid size in {label}: {size_text}") from error
        require(size >= 0, f"negative size in {label}: {size_text}")
        require(filename not in result, f"duplicate SHA256 path in {label}: {filename}")
        result[filename] = (size, digest.lower())
    return result


def verify_release(root: Path, keyring: Path) -> tuple[dict[str, str], str, list[dict]]:
    release_path = root / "InRelease"
    require_regular_file(release_path, "Ubuntu InRelease")
    require_regular_file(keyring, "Ubuntu archive keyring")
    check = subprocess.run(
        [
            "gpgv",
            "--status-fd",
            "2",
            "--output",
            "-",
            "--keyring",
            str(keyring),
            str(release_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    require(
        check.returncode == 0,
        "Ubuntu InRelease signature verification failed",
    )
    valid_signers = {
        line.split()[2]
        for line in check.stderr.splitlines()
        if line.startswith("[GNUPG:] VALIDSIG ") and len(line.split()) >= 3
    }
    require(
        SIGNER in valid_signers,
        f"Ubuntu InRelease was not signed by expected archive key {SIGNER}",
    )
    metadata = parse_text_record(check.stdout, "signed Ubuntu Release")
    require(metadata.get("Suite") == SUITE, "unexpected Ubuntu Release suite")
    require(metadata.get("Codename") == SUITE, "unexpected Ubuntu Release codename")
    components = set(metadata.get("Components", "").split())
    require({"main", "universe"} <= components, "main/universe components are missing")
    architectures = set(metadata.get("Architectures", "").split())
    require(ARCHITECTURE in architectures, "amd64 is missing from signed Release")
    require("SHA256" in metadata, "signed Release has no SHA256 field")
    hashes = parse_sha256_field(metadata["SHA256"], "signed Ubuntu Release")

    verified_indexes: list[dict] = []
    for local_name, remote_name, component, compressed in INDEXES:
        path = root / local_name
        require_regular_file(path, f"{component} {'source' if compressed else 'binary'} index")
        require(remote_name in hashes, f"signed Release has no hash for {remote_name}")
        expected_size, expected_sha = hashes[remote_name]
        actual_size = path.stat().st_size
        actual_sha = sha256_file(path)
        require(
            actual_size == expected_size,
            f"size mismatch for {local_name}: expected {expected_size}, got {actual_size}",
        )
        require(
            actual_sha == expected_sha,
            f"SHA-256 mismatch for {local_name}: expected {expected_sha}, got {actual_sha}",
        )
        verified_indexes.append(
            {
                "file": local_name,
                "signedPath": remote_name,
                "component": component,
                "compressed": compressed,
                "bytes": actual_size,
                "sha256": actual_sha,
            }
        )
    return metadata, sha256_file(release_path), verified_indexes


def safe_package_filename(value: str) -> str:
    path = PurePosixPath(value)
    require(
        value and not path.is_absolute() and "\\" not in value and ".." not in path.parts,
        f"unsafe package Filename field: {value}",
    )
    require(path.name not in ("", ".", ".."), f"invalid package Filename field: {value}")
    return value


def parse_source(value: str | None, package: str, version: str) -> tuple[str, str]:
    if not value:
        return package, version
    match = re.fullmatch(r"([^\s()]+)(?:\s+\(([^()]+)\))?", value.strip())
    require(match is not None, f"malformed Source field for {package}={version}: {value}")
    return match.group(1), match.group(2) or version


def load_package_records(root: Path) -> dict[tuple[str, str, str], dict]:
    records: dict[tuple[str, str, str], dict] = {}
    for local_name, _remote, component, compressed in INDEXES:
        if compressed:
            continue
        path = root / local_name
        with path.open("r", encoding="utf-8", errors="strict") as stream:
            for record in parse_paragraphs(stream):
                if "Package" not in record:
                    continue
                required = ("Version", "Architecture", "Filename", "Size", "SHA256")
                require(
                    all(field in record for field in required),
                    f"binary package record is missing a required field: {record.get('Package')}",
                )
                package = record["Package"]
                version = record["Version"]
                architecture = record["Architecture"]
                require(
                    architecture in (ARCHITECTURE, "all"),
                    f"binary index has an unexpected architecture: {package}={version}/{architecture}",
                )
                try:
                    size = int(record["Size"])
                except ValueError as error:
                    raise LockError(
                        f"invalid package size for {package}={version}: {record['Size']}"
                    ) from error
                require(size >= 0, f"negative package size for {package}={version}")
                digest = record["SHA256"].lower()
                require(
                    re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
                    f"invalid package SHA256 for {package}={version}",
                )
                identity = (package, version, architecture)
                require(identity not in records, f"duplicate package identity: {identity}")
                filename = safe_package_filename(record["Filename"])
                require(
                    filename.startswith(f"pool/{component}/"),
                    f"package Filename does not match its component: {filename}",
                )
                records[identity] = {
                    "name": package,
                    "version": version,
                    "architecture": architecture,
                    "component": component,
                    "source": parse_source(record.get("Source"), package, version),
                    "filename": filename,
                    "size": size,
                    "sha256": digest,
                }
    require(records, "signed binary indexes contained no package records")
    return records


def load_source_records(root: Path) -> dict[tuple[str, str], str]:
    records: dict[tuple[str, str], str] = {}
    for local_name, _remote, component, compressed in INDEXES:
        if not compressed:
            continue
        path = root / local_name
        with lzma.open(path, "rt", encoding="utf-8", errors="strict") as stream:
            for record in parse_paragraphs(stream):
                if "Package" not in record or "Version" not in record:
                    fail("source record is missing Package or Version")
                identity = (record["Package"], record["Version"])
                require(
                    identity not in records,
                    f"duplicate source identity: {identity}",
                )
                records[identity] = component
    require(records, "signed source indexes contained no source records")
    return records


def prepare_apt_cache(root: Path) -> tuple[tempfile.TemporaryDirectory, object]:
    temp_root = tempfile.TemporaryDirectory(prefix="orbsie-ubuntu-apt-")
    base = Path(temp_root.name)
    state_lists = base / "state" / "lists"
    (state_lists / "partial").mkdir(parents=True)
    (base / "state").mkdir(exist_ok=True)
    (base / "state" / "status").write_text("", encoding="utf-8")
    (base / "cache" / "archives" / "partial").mkdir(parents=True)
    apt_etc = base / "etc" / "apt"
    (apt_etc / "apt.conf.d").mkdir(parents=True)
    (apt_etc / "preferences.d").mkdir(parents=True)
    (apt_etc / "sources.list.d").mkdir(parents=True)
    (apt_etc / "trusted.gpg.d").mkdir(parents=True)
    (apt_etc / "sources.list").write_text(
        "deb [trusted=yes] http://offline.invalid/ubuntu/ noble main universe\n",
        encoding="utf-8",
    )
    list_names = {
        "main-Packages": "offline.invalid_ubuntu_dists_noble_main_binary-amd64_Packages",
        "Packages": "offline.invalid_ubuntu_dists_noble_universe_binary-amd64_Packages",
    }
    for local_name, list_name in list_names.items():
        os.symlink(root / local_name, state_lists / list_name)

    config_path = base / "apt.conf"
    config_path.write_text(
        f'Dir::Etc "{apt_etc}";\n'
        'Dir::Etc::parts "apt.conf.d";\n'
        'Dir::Etc::main "apt.conf";\n',
        encoding="utf-8",
    )
    previous_apt_config = os.environ.get("APT_CONFIG")
    os.environ["APT_CONFIG"] = str(config_path)
    try:
        apt_pkg.config.clear("")
        apt_pkg.init_config()
        config = apt_pkg.config
        values = {
            "Dir": base,
            "Dir::State": base / "state",
            "Dir::State::status": base / "state" / "status",
            "Dir::State::lists": state_lists,
            "Dir::Etc": apt_etc,
            "Dir::Etc::sourcelist": "sources.list",
            "Dir::Etc::sourceparts": "sources.list.d",
            "Dir::Etc::parts": "apt.conf.d",
            "Dir::Etc::main": "apt.conf",
            "Dir::Etc::preferences": "/dev/null",
            "Dir::Etc::preferencesparts": "preferences.d",
            "Dir::Etc::trusted": "/dev/null",
            "Dir::Etc::trustedparts": "trusted.gpg.d",
            "Dir::Cache": base / "cache",
            "Dir::Cache::archives": base / "cache" / "archives",
            "Dir::Cache::pkgcache": "",
            "Dir::Cache::srcpkgcache": "",
            "APT::Architecture": ARCHITECTURE,
            "APT::Install-Recommends": "false",
            "APT::Install-Suggests": "false",
        }
        for key, value in values.items():
            config.set(key, str(value))
        config.clear("APT::Architectures")
        config.set("APT::Architectures::0", ARCHITECTURE)
        apt_pkg.init_system()
        cache = apt_pkg.Cache(None)
    except Exception:
        temp_root.cleanup()
        raise
    finally:
        if previous_apt_config is None:
            os.environ.pop("APT_CONFIG", None)
        else:
            os.environ["APT_CONFIG"] = previous_apt_config
    return temp_root, cache


def resolve_packages(cache: object) -> tuple[list[dict], dict[str, str]]:
    depcache = apt_pkg.DepCache(cache)
    roots: dict[str, str] = {}
    for package_name, requested_version in ROOTS:
        try:
            package = cache[package_name]
        except KeyError as error:
            fail(f"resolver index has no required root package: {package_name}")
        require(
            package.current_ver is None,
            f"resolver unexpectedly used installed status for {package_name}",
        )
        candidate = depcache.get_candidate_ver(package)
        require(candidate is not None, f"no candidate version for root {package_name}")
        if requested_version is not None:
            matches = [
                version
                for version in package.version_list
                if version.ver_str == requested_version
                and version.arch in (ARCHITECTURE, "all")
            ]
            require(
                len(matches) == 1,
                f"exact root version is missing or ambiguous: {package_name}={requested_version}",
            )
            require(
                depcache.set_candidate_ver(package, matches[0]),
                f"could not pin root candidate: {package_name}={requested_version}",
            )
            candidate = depcache.get_candidate_ver(package)
        roots[package_name] = candidate.ver_str
        depcache.mark_install(package, True, False)

    require(depcache.fix_broken(), "apt resolver could not fix the dependency graph")
    require(depcache.broken_count == 0, f"apt resolver left {depcache.broken_count} broken packages")
    for package_name, requested_version in ROOTS:
        package = cache[package_name]
        require(
            depcache.marked_install(package),
            f"apt resolver dropped required root package: {package_name}",
        )
        candidate = depcache.get_candidate_ver(package)
        require(
            candidate is not None and candidate.ver_str == roots[package_name],
            f"apt resolver changed required root candidate: {package_name}",
        )

    selected: list[tuple[str, object]] = []
    for package in cache.packages:
        require(
            package.current_ver is None,
            "resolver cache contains an installed package despite empty status",
        )
        if not depcache.marked_install(package):
            continue
        version = depcache.get_candidate_ver(package)
        require(version is not None, f"selected package has no candidate: {package.name}")
        require(
            version.arch in (ARCHITECTURE, "all"),
            f"selected package has unsupported architecture: {package.name}={version.ver_str}/{version.arch}",
        )
        selected.append((package.name, version))

    require(selected, "apt resolver selected no packages")
    result = []
    for package_name, version in selected:
        result.append(
            {
                "name": package_name,
                "version": version.ver_str,
                "architecture": version.arch,
            }
        )
    result.sort(key=lambda item: (item["name"], item["architecture"], item["version"]))
    return result, roots


def build_lock(
    root: Path,
    keyring: Path,
) -> dict:
    metadata, release_sha, verified_indexes = verify_release(root, keyring)
    package_records = load_package_records(root)
    source_records = load_source_records(root)
    temp_root, cache = prepare_apt_cache(root)
    try:
        selected, roots = resolve_packages(cache)
    finally:
        temp_root.cleanup()

    locked_packages = []
    for selected_package in selected:
        identity = (
            selected_package["name"],
            selected_package["version"],
            selected_package["architecture"],
        )
        require(identity in package_records, f"selected package is absent from signed indexes: {identity}")
        record = package_records[identity]
        source_name, source_version = record["source"]
        source_identity = (source_name, source_version)
        require(
            source_identity in source_records,
            f"selected package source is absent from signed source indexes: {source_identity}",
        )
        locked_packages.append(
            {
                "name": record["name"],
                "version": record["version"],
                "architecture": record["architecture"],
                "component": record["component"],
                "source": {
                    "name": source_name,
                    "version": source_version,
                    "component": source_records[source_identity],
                },
                "filename": record["filename"],
                "size": record["size"],
                "sha256": record["sha256"],
            }
        )
    locked_packages.sort(
        key=lambda item: (item["name"], item["architecture"], item["version"])
    )
    return {
        "schema": SCHEMA,
        "status": "candidate",
        "distribution": {
            "suite": SUITE,
            "codename": metadata["Codename"],
            "architecture": ARCHITECTURE,
            "releaseDate": metadata.get("Date"),
            "releaseSha256": release_sha,
            "signer": SIGNER,
            "components": ["main", "universe"],
        },
        "resolver": {
            "engine": "apt_pkg",
            "aptPkgVersion": apt_pkg.VERSION,
            "installedStatus": "empty",
            "repositories": ["main", "universe"],
            "architecture": ARCHITECTURE,
            "installRecommends": False,
            "installSuggests": False,
            "roots": roots,
            "selectedCount": len(locked_packages),
            "downloadBytes": sum(item["size"] for item in locked_packages),
        },
        "indexes": verified_indexes,
        "packages": locked_packages,
    }


def write_lock(path: Path, lock: dict) -> None:
    require(path.parent.is_dir(), f"output parent is not a directory: {path.parent}")
    if path.exists() or path.is_symlink():
        fail(f"output exists: {path}")
    payload = json.dumps(lock, indent=2, sort_keys=True) + "\n"
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
        text=True,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        # Publish without replacing a destination created after the initial check.
        os.link(temporary, path)
        os.unlink(temporary)
    except Exception:
        try:
            Path(temporary).unlink()
        except FileNotFoundError:
            pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_directory", type=Path)
    parser.add_argument("output_lock", type=Path)
    parser.add_argument(
        "--keyring",
        type=Path,
        default=Path("/usr/share/keyrings/ubuntu-archive-keyring.gpg"),
    )
    args = parser.parse_args(argv)
    root = args.input_directory.resolve()
    require(root.is_dir(), f"input directory is not a directory: {root}")
    lock = build_lock(root, args.keyring)
    write_lock(args.output_lock, lock)
    print(
        json.dumps(
            {
                "status": "ok",
                "output": str(args.output_lock),
                "selectedCount": lock["resolver"]["selectedCount"],
                "downloadBytes": lock["resolver"]["downloadBytes"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        LockError,
        OSError,
        UnicodeError,
        lzma.LZMAError,
        subprocess.SubprocessError,
        apt_pkg.Error,
    ) as error:
        print(f"[ubuntu-lock] error: {error}", file=sys.stderr)
        raise SystemExit(1)

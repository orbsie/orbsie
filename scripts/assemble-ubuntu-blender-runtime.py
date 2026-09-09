#!/usr/bin/env python3
"""Assemble an offline Ubuntu Blender candidate rootfs from verified .deb data.

This command only verifies package archives, reads their control/data members,
and extracts payload files. It never runs apt, dpkg installation, maintainer
scripts, triggers, alternatives, ldconfig, Blender, or the packaged Python runtime.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile


SCHEMA = "orbsie.ubuntu-blender-runtime/v1"
TREE_SCHEMA = "orbsie.ubuntu-blender-runtime/tree-integrity/v1"
MANIFEST_NAME = "manifest.json"
OWNER_MARKER = ".orbsie-ubuntu-assembly-owner"
USR_MERGE_LINKS = {
    "bin": "usr/bin",
    "sbin": "usr/sbin",
    "lib": "usr/lib",
    "lib64": "usr/lib64",
}


class AssemblyError(ValueError):
    """A candidate input or payload assembly failure."""


def fail(message: str) -> None:
    raise AssemblyError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_potential_path(path: Path) -> Path:
    """Resolve existing parent symlinks without creating the final path."""
    current = path.absolute()
    suffix: list[str] = []
    while not os.path.lexists(current):
        parent = current.parent
        require(parent != current, f"cannot resolve output parent: {path}")
        suffix.insert(0, current.name)
        current = parent
    current = Path(os.path.realpath(current))
    return current.joinpath(*suffix)


def is_contained(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def require_real_directory(path: Path, label: str) -> Path:
    try:
        info = path.lstat()
    except FileNotFoundError as error:
        raise AssemblyError(f"{label} is missing: {path}") from error
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), f"{label} must be a real directory: {path}")
    return Path(os.path.realpath(path))


def safe_lock_path(value: object, label: str) -> str:
    require(isinstance(value, str) and value, f"{label} must be a non-empty string")
    path = PurePosixPath(value)
    require(not path.is_absolute(), f"{label} must be relative: {value}")
    require("\\" not in value and "\x00" not in value, f"{label} contains an unsafe character")
    require(".." not in path.parts, f"{label} escapes its root: {value}")
    normalized = "/".join(part for part in path.parts if part not in ("", "."))
    require(normalized.startswith("pool/"), f"{label} must be under pool/: {value}")
    require(normalized != "pool", f"{label} names a directory: {value}")
    return normalized


def load_lock(path: Path) -> tuple[dict, list[dict]]:
    try:
        lock = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AssemblyError(f"cannot read dependency lock {path}: {error}") from error
    require(isinstance(lock, dict), "dependency lock must be an object")
    require(lock.get("schema") == "orbsie.ubuntu-blender-dependency-lock/v1", "unexpected dependency lock schema")
    require(lock.get("status") == "candidate", "dependency lock must remain status=candidate")
    distribution = lock.get("distribution")
    require(isinstance(distribution, dict), "dependency lock distribution is missing")
    require(distribution.get("codename") == "noble", "dependency lock is not Ubuntu Noble")
    require(distribution.get("architecture") == "amd64", "dependency lock is not amd64")
    packages = lock.get("packages")
    require(isinstance(packages, list) and packages, "dependency lock has no packages")
    normalized: list[dict] = []
    seen_identity: set[tuple[str, str, str]] = set()
    seen_filenames: set[str] = set()
    required = {"name", "version", "architecture", "filename", "size", "sha256", "source"}
    for index, package in enumerate(packages):
        require(isinstance(package, dict), f"lock package {index} must be an object")
        require(required <= package.keys(), f"lock package {index} is missing fields")
        name = package["name"]
        version = package["version"]
        architecture = package["architecture"]
        require(isinstance(name, str) and name and "/" not in name and "\\" not in name, f"invalid package name at index {index}")
        require(isinstance(version, str) and version, f"invalid package version for {name}")
        require(architecture in ("amd64", "all"), f"unexpected package architecture for {name}: {architecture}")
        filename = safe_lock_path(package["filename"], f"lock package filename for {name}")
        size = package["size"]
        require(isinstance(size, int) and not isinstance(size, bool) and size >= 0, f"invalid package size for {name}")
        digest = package["sha256"]
        require(isinstance(digest, str) and len(digest) == 64 and all(c in "0123456789abcdefABCDEF" for c in digest), f"invalid package SHA-256 for {name}")
        source = package["source"]
        require(isinstance(source, dict), f"invalid source metadata for {name}")
        identity = (name, version, architecture)
        require(identity not in seen_identity, f"duplicate package identity in lock: {identity}")
        require(filename not in seen_filenames, f"duplicate package filename in lock: {filename}")
        seen_identity.add(identity)
        seen_filenames.add(filename)
        normalized.append({**package, "filename": filename, "sha256": digest.lower()})
    normalized.sort(key=lambda item: (item["name"], item["version"], item["architecture"], item["filename"]))
    return lock, normalized


def package_archive(cache_root: Path, package: dict) -> Path:
    archive = cache_root.joinpath(*PurePosixPath(package["filename"]).parts)
    require(is_contained(cache_root, archive.absolute()), f"package archive escapes cache: {package['filename']}")
    resolved = Path(os.path.realpath(archive))
    require(is_contained(cache_root, resolved), f"package archive resolves outside cache: {package['filename']}")
    try:
        info = archive.lstat()
    except FileNotFoundError as error:
        raise AssemblyError(f"package archive is missing: {package['filename']}") from error
    require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), f"package archive must be a regular file: {package['filename']}")
    require(info.st_size == package["size"], f"package archive size mismatch for {package['name']}: expected {package['size']}, got {info.st_size}")
    actual = sha256_file(archive)
    require(actual == package["sha256"], f"package archive SHA-256 mismatch for {package['name']}: expected {package['sha256']}, got {actual}")
    return archive


def package_control_identity(archive: Path) -> dict[str, str]:
    try:
        result = subprocess.run(
            [
                "dpkg-deb",
                "--showformat=${Package}\\n${Version}\\n${Architecture}\\n",
                "--show",
                str(archive),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AssemblyError(f"cannot inspect Debian control metadata for {archive.name}: {error}") from error
    require(result.returncode == 0, f"dpkg-deb control inspection failed for {archive.name}: {result.stderr.strip()}")
    fields = result.stdout.splitlines()
    require(len(fields) == 3 and all(fields), f"Debian control identity is incomplete for {archive.name}")
    return {"name": fields[0], "version": fields[1], "architecture": fields[2]}


def data_tar(archive: Path) -> tarfile.TarFile:
    try:
        result = subprocess.run(
            ["dpkg-deb", "--fsys-tarfile", str(archive)],
            check=False,
            capture_output=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AssemblyError(f"cannot read Debian data archive {archive.name}: {error}") from error
    require(result.returncode == 0, f"dpkg-deb data extraction failed for {archive.name}: {result.stderr.decode(errors='replace').strip()}")
    try:
        return tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:")
    except (tarfile.TarError, OSError) as error:
        raise AssemblyError(f"Debian data member is not a valid tar archive for {archive.name}: {error}") from error


def normalize_member_name(raw: str, label: str) -> str | None:
    require(isinstance(raw, str) and "\x00" not in raw and "\\" not in raw, f"unsafe archive path in {label}")
    require(not raw.startswith("/"), f"absolute archive path in {label}: {raw}")
    parts = raw.split("/")
    result: list[str] = []
    for part in parts:
        if part in ("", "."):
            continue
        require(part != "..", f"archive path traversal in {label}: {raw}")
        result.append(part)
    return "/".join(result) or None


def normalized_target(link_path: str, raw: str, label: str) -> tuple[str, str, bool]:
    require(isinstance(raw, str) and raw and "\x00" not in raw and "\\" not in raw, f"unsafe link target in {label}")
    absolute = raw.startswith("/")
    candidate = raw.lstrip("/") if absolute else posixpath.join(posixpath.dirname(link_path), raw)
    parts: list[str] = []
    for part in candidate.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            require(parts, f"link target escapes root in {label}: {raw}")
            parts.pop()
        else:
            parts.append(part)
    target_path = "/".join(parts)
    relative_target = posixpath.relpath(target_path or ".", posixpath.dirname(link_path) or ".")
    require(relative_target not in ("", "/") and not relative_target.startswith("/"), f"invalid normalized link target in {label}: {raw}")
    return relative_target, target_path, absolute


def normalized_hardlink_target(raw: str, label: str) -> str:
    require(isinstance(raw, str) and raw and "\x00" not in raw and "\\" not in raw, f"unsafe hardlink target in {label}")
    candidate = raw.lstrip("/") if raw.startswith("/") else raw
    parts: list[str] = []
    for part in candidate.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            require(parts, f"hardlink target escapes archive root in {label}: {raw}")
            parts.pop()
        else:
            parts.append(part)
    require(parts, f"empty hardlink target in {label}")
    return "/".join(parts)


@dataclass(frozen=True)
class PayloadEntry:
    package_name: str
    package_filename: str
    archive_name: str
    path: str
    kind: str
    mode: int
    size: int = 0
    target: str | None = None
    target_path: str | None = None
    original_target: str | None = None
    absolute_target: bool = False


def inspect_package(package: dict, archive: Path) -> tuple[list[PayloadEntry], list[dict]]:
    identity = package_control_identity(archive)
    for field in ("name", "version", "architecture"):
        require(identity[field] == package[field], f"Debian control {field} mismatch for {package['name']}: lock={package[field]!r}, archive={identity[field]!r}")
    records: list[PayloadEntry] = []
    transformations: list[dict] = []
    with data_tar(archive) as tar:
        seen: set[str] = set()
        for member in tar:
            path = normalize_member_name(member.name, f"{package['name']}:{member.name}")
            if path is None:
                continue
            require(path not in seen, f"duplicate data path in {package['name']}: {path}")
            seen.add(path)
            mode = member.mode & 0o7777
            if member.isdir():
                records.append(PayloadEntry(package["name"], package["filename"], member.name, path, "directory", mode))
            elif member.isreg():
                records.append(PayloadEntry(package["name"], package["filename"], member.name, path, "file", mode, member.size))
            elif member.issym():
                target, target_path, absolute = normalized_target(path, member.linkname, f"{package['name']}:{path}")
                records.append(PayloadEntry(package["name"], package["filename"], member.name, path, "symlink", mode, target=target, target_path=target_path, original_target=member.linkname, absolute_target=absolute))
                if absolute:
                    transformations.append({"package": package["name"], "path": path, "from": member.linkname, "to": target})
            elif member.islnk():
                target_path = normalized_hardlink_target(member.linkname, f"{package['name']}:{path}")
                records.append(PayloadEntry(package["name"], package["filename"], member.name, path, "hardlink", mode, target=target_path, target_path=target_path, original_target=member.linkname))
            else:
                fail(f"unsupported special file in {package['name']}: {path}")
    return records, transformations


def plan_payload(packages: list[dict], cache_root: Path) -> tuple[dict[str, PayloadEntry], list[dict], dict[str, int]]:
    entries: dict[str, PayloadEntry] = {}
    transformations: list[dict] = []
    package_counts: dict[str, int] = {}
    for package in packages:
        archive = package_archive(cache_root, package)
        records, changes = inspect_package(package, archive)
        transformations.extend(changes)
        package_counts[package["filename"]] = len(records)
        for record in records:
            require(record.path not in (MANIFEST_NAME, OWNER_MARKER), f"package payload reserves assembler path: {record.path}")
            previous = entries.get(record.path)
            if previous is None:
                entries[record.path] = record
                continue
            if previous.kind == record.kind == "directory" and previous.mode == record.mode:
                continue
            fail(f"conflicting package payload path {record.path}: {previous.package_name} versus {record.package_name}")
    for path, record in entries.items():
        parts = path.split("/")
        for index in range(1, len(parts)):
            ancestor = "/".join(parts[:index])
            parent = entries.get(ancestor)
            if parent is not None and parent.kind != "directory":
                fail(f"payload path {path} is beneath non-directory {ancestor}")
        if record.kind == "hardlink":
            target = entries.get(record.target_path or "")
            require(target is not None and target.kind in ("file", "hardlink"), f"hardlink target is absent or not a regular payload file: {path} -> {record.target}")
    return entries, sorted(transformations, key=lambda item: (item["path"], item["package"])), package_counts


def lstat_or_none(path: Path) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def ensure_parent_directory(root: Path, relative: str) -> None:
    current = root
    for part in PurePosixPath(relative).parts[:-1]:
        current /= part
        info = lstat_or_none(current)
        if info is None:
            current.mkdir()
        else:
            require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), f"payload parent is not a real directory: {relative}")


def extract_regular(root: Path, tar: tarfile.TarFile, member: tarfile.TarInfo, destination: Path, relative: str, mode: int, label: str) -> None:
    ensure_parent_directory(root, relative)
    require(not os.path.lexists(destination), f"destination path already exists during extraction: {label}")
    source = tar.extractfile(member)
    require(source is not None, f"regular payload has no data stream: {label}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(destination, flags, mode & 0o7777)
    try:
        copied = 0
        with os.fdopen(fd, "wb") as output:
            fd = -1
            while chunk := source.read(1024 * 1024):
                copied += len(chunk)
                output.write(chunk)
        require(copied == member.size, f"regular payload size changed while extracting: {label}")
        os.chmod(destination, mode & 0o7777, follow_symlinks=False)
    finally:
        source.close()
        if fd != -1:
            os.close(fd)


def extract_payload(packages: list[dict], cache_root: Path, root: Path, entries: dict[str, PayloadEntry]) -> None:
    directories = sorted((entry for entry in entries.values() if entry.kind == "directory"), key=lambda entry: (entry.path.count("/"), entry.path))
    for entry in directories:
        destination = root.joinpath(*PurePosixPath(entry.path).parts)
        ensure_parent_directory(root, entry.path)
        info = lstat_or_none(destination)
        if info is None:
            destination.mkdir(mode=0o700)
        else:
            require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), f"payload directory is not a real directory: {entry.path}")
    for package in packages:
        archive = package_archive(cache_root, package)
        with data_tar(archive) as tar:
            by_archive_name = {entry.archive_name: entry for entry in entries.values() if entry.package_filename == package["filename"]}
            for member in tar:
                entry = by_archive_name.get(member.name)
                if entry is None:
                    continue
                destination = root.joinpath(*PurePosixPath(entry.path).parts)
                if entry.kind == "file":
                    ensure_parent_directory(root, entry.path)
                    extract_regular(root, tar, member, destination, entry.path, entry.mode, f"{package['name']}:{entry.path}")
    hardlinks = [entry for entry in entries.values() if entry.kind == "hardlink"]
    pending = list(sorted(hardlinks, key=lambda entry: entry.path))
    while pending:
        next_pending: list[PayloadEntry] = []
        progress = False
        for entry in pending:
            destination = root.joinpath(*PurePosixPath(entry.path).parts)
            target = root.joinpath(*PurePosixPath(entry.target_path or "").parts)
            ensure_parent_directory(root, entry.path)
            if not os.path.lexists(target):
                next_pending.append(entry)
                continue
            target_info = target.lstat()
            require(stat.S_ISREG(target_info.st_mode) and not stat.S_ISLNK(target_info.st_mode), f"hardlink target is not a regular file: {entry.path}")
            require(not os.path.lexists(destination), f"destination path already exists during hardlink extraction: {entry.path}")
            os.link(target, destination, follow_symlinks=False)
            os.chmod(destination, entry.mode & 0o7777, follow_symlinks=False)
            progress = True
        require(progress, f"hardlink targets could not be materialized: {[entry.path for entry in next_pending]}")
        pending = next_pending
    for entry in sorted((entry for entry in entries.values() if entry.kind == "symlink"), key=lambda item: item.path):
        destination = root.joinpath(*PurePosixPath(entry.path).parts)
        ensure_parent_directory(root, entry.path)
        require(not os.path.lexists(destination), f"destination path already exists during symlink extraction: {entry.path}")
        os.symlink(entry.target, destination)
    for entry in sorted(directories, key=lambda item: (item.path.count("/"), item.path), reverse=True):
        destination = root.joinpath(*PurePosixPath(entry.path).parts)
        os.chmod(destination, entry.mode & 0o7777, follow_symlinks=False)


def ensure_usrmerge(root: Path) -> list[dict]:
    generated: list[dict] = []
    for link, target in USR_MERGE_LINKS.items():
        target_path = root.joinpath(*PurePosixPath(target).parts)
        target_info = lstat_or_none(target_path)
        if target_info is None:
            target_path.mkdir(mode=0o755, parents=True)
            generated.append({"path": target, "kind": "directory", "reason": "usrmerge target"})
        else:
            require(stat.S_ISDIR(target_info.st_mode) and not stat.S_ISLNK(target_info.st_mode), f"usrmerge target must be a real directory: {target}")
        link_path = root / link
        link_info = lstat_or_none(link_path)
        if link_info is not None:
            if stat.S_ISLNK(link_info.st_mode):
                actual = os.readlink(link_path)
                _normalized, target_path_name, _absolute = normalized_target(link, actual, f"usrmerge {link}")
                require(target_path_name == target, f"unexpected merged-usr link target: {link} -> {actual}")
                continue
            require(stat.S_ISDIR(link_info.st_mode), f"usrmerge path is not a directory or symlink: {link}")
            require(not any(link_path.iterdir()), f"usrmerge directory has payload entries and cannot be normalized: {link}")
            link_path.rmdir()
        os.symlink(target, link_path)
        generated.append({"path": link, "kind": "symlink", "target": target, "reason": "usrmerge"})
    return generated


def tree_entries(root: Path) -> list[dict]:
    result: list[dict] = []

    def visit(current: Path, prefix: str = "") -> None:
        for child in sorted(current.iterdir(), key=lambda path: path.name):
            relative = f"{prefix}/{child.name}" if prefix else child.name
            if relative == OWNER_MARKER:
                continue
            info = child.lstat()
            mode = stat.S_IMODE(info.st_mode) | (info.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX))
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(child)
                require(is_contained(root, Path(os.path.realpath(child))), f"resolved symlink escapes root: {relative}")
                _normalized, target_path, _absolute = normalized_target(relative, target, f"tree symlink {relative}")
                require(not target_path.startswith("../") and target_path != "..", f"tree symlink escapes root: {relative} -> {target}")
                result.append({"path": relative, "kind": "symlink", "mode": mode, "target": target})
            elif stat.S_ISDIR(info.st_mode):
                result.append({"path": relative, "kind": "directory", "mode": mode})
                visit(child, relative)
            elif stat.S_ISREG(info.st_mode):
                result.append({"path": relative, "kind": "file", "mode": mode, "bytes": info.st_size, "sha256": sha256_file(child)})
            else:
                fail(f"assembled rootfs contains unsupported special file: {relative}")

    visit(root)
    result.sort(key=lambda entry: entry["path"])
    return result


def integrity_digest(entries: list[dict]) -> str:
    encoded = json.dumps(entries, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def make_owner_marker(root: Path) -> str:
    token = secrets.token_hex(32)
    marker = root / OWNER_MARKER
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(marker, flags, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as stream:
        stream.write(token)
    return token


def cleanup_owned_output(root: Path, token: str) -> None:
    marker = root / OWNER_MARKER
    try:
        info = marker.lstat()
        valid = stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode) and marker.read_text(encoding="ascii") == token
    except (FileNotFoundError, OSError, UnicodeError):
        valid = False
    if not valid:
        return
    try:
        for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current)
            os.chmod(current_path, stat.S_IMODE(current_path.lstat().st_mode) | 0o700, follow_symlinks=False)
            dirs[:] = [name for name in dirs if not (current_path / name).is_symlink()]
        shutil.rmtree(root)
    except OSError:
        # Keep a partial candidate rather than risk deleting an unowned path.
        return


def assemble(lock_path: Path, cache_path: Path, output_path: Path) -> dict:
    lock, packages = load_lock(lock_path)
    cache_root = require_real_directory(cache_path, "package cache")
    output = canonical_potential_path(output_path)
    require(not os.path.lexists(output), f"output already exists and will not be overwritten: {output}")
    parent = require_real_directory(output.parent, "output parent")
    output = parent / output.name
    require(not is_contained(cache_root, output) and not is_contained(output, cache_root), "output and package cache must not overlap")
    entries, transformations, package_counts = plan_payload(packages, cache_root)
    owner_token: str | None = None
    created = False
    try:
        output.mkdir(mode=0o700)
        created = True
        owner_token = make_owner_marker(output)
        extract_payload(packages, cache_root, output, entries)
        generated = ensure_usrmerge(output)
        actual_entries = tree_entries(output)
        integrity = {
            "schema": TREE_SCHEMA,
            "excluded": [MANIFEST_NAME],
            "entryCount": len(actual_entries),
            "treeSha256": integrity_digest(actual_entries),
            "entries": actual_entries,
        }
        manifest_packages = []
        for package in packages:
            manifest_packages.append({
                "name": package["name"],
                "version": package["version"],
                "architecture": package["architecture"],
                "filename": package["filename"],
                "size": package["size"],
                "sha256": package["sha256"],
                "source": package["source"],
                "payloadEntries": package_counts[package["filename"]],
            })
        manifest = {
            "schema": SCHEMA,
            "status": "candidate",
            "candidate": True,
            "portable": False,
            "releaseCertified": False,
            "scope": "verified Ubuntu .deb data payload and merged-usr layout only; no maintainer scripts or runtime execution",
            "distribution": {
                "suite": lock["distribution"]["suite"],
                "codename": lock["distribution"]["codename"],
                "architecture": lock["distribution"]["architecture"],
            },
            "source": {
                "lockSchema": lock["schema"],
                "lockSha256": sha256_file(lock_path),
                "packageCount": len(packages),
            },
            "packages": manifest_packages,
            "generated": {
                "symlinkNormalizations": transformations,
                "usrmerge": generated,
            },
            "integrity": integrity,
            "limitations": [
                "No Debian maintainer scripts, triggers, alternatives database, ldconfig cache, Blender, or packaged Python runtime probes were run.",
                "Portability, clean-host execution, native dependency closure behavior, and release provenance remain open gates.",
            ],
        }
        manifest_path = output / MANIFEST_NAME
        with manifest_path.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.unlink(output / OWNER_MARKER)
        os.chmod(output, 0o755)
        return {"output": str(output), "manifest": manifest}
    except Exception:
        if created and owner_token is not None:
            cleanup_owned_output(output, owner_token)
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lock", type=Path, help="candidate dependency lock JSON")
    parser.add_argument("cache", type=Path, help="offline cache containing pool/<component>/... .deb files")
    parser.add_argument("output", type=Path, help="new output rootfs directory")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        result = assemble(args.lock, args.cache, args.output)
    except (AssemblyError, OSError, subprocess.SubprocessError) as error:
        print(f"[assemble-ubuntu-blender-runtime] {error}", file=sys.stderr)
        return 1
    manifest = result["manifest"]
    print(json.dumps({"output": result["output"], "status": manifest["status"], "manifest": str(Path(result["output"]) / MANIFEST_NAME), "entryCount": manifest["integrity"]["entryCount"], "treeSha256": manifest["integrity"]["treeSha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Acquire notices for exact bundled Python versions; never execute packages."""
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

VERSIONS = {
    "Cython": "0.29.30", "autopep8": "1.6.0", "certifi": "2021.10.8",
    "charset-normalizer": "2.0.10", "idna": "3.3", "pycodestyle": "2.8.0",
    "requests": "2.27.1", "toml": "0.10.2", "urllib3": "1.26.8",
}
OUTPUT = Path(__file__).resolve().parents[1] / "third_party/blender-python-notices"
OUTPUT.mkdir(parents=True, exist_ok=True)
manifest_path = OUTPUT / "manifest.json"
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
pins = {(entry["name"], entry["version"]): entry["archiveSha256"] for entry in previous}
records = []
requests = 0

def fetch(url, limit):
    global requests
    if requests >= 18:
        raise RuntimeError("Request budget exhausted")
    if urlparse(url).scheme != "https" or urlparse(url).hostname not in {"pypi.org", "files.pythonhosted.org"}:
        raise RuntimeError("Unexpected source host")
    time.sleep(2)
    requests += 1
    # No retries: rate limits and access failures stop the acquisition.
    with urlopen(Request(url, headers={"User-Agent": "Orbsie-license-inventory/1.0"}), timeout=30) as response:
        if urlparse(response.url).hostname not in {"pypi.org", "files.pythonhosted.org"}:
            raise RuntimeError("Unexpected redirect host")
        data = response.read(limit + 1)
        if len(data) > limit:
            raise RuntimeError("Source exceeds byte budget")
        return data

for name, version in VERSIONS.items():
    metadata_url = f"https://pypi.org/pypi/{name}/{version}/json"
    metadata = json.loads(fetch(metadata_url, 2 * 1024 * 1024))
    sources = [item for item in metadata["urls"] if item["packagetype"] == "sdist" and item["filename"].endswith(".tar.gz")]
    if len(sources) != 1:
        raise RuntimeError(f"Expected one source archive for {name}")
    source = sources[0]
    expected = source["digests"]["sha256"]
    if (name, version) in pins and pins[(name, version)] != expected:
        raise RuntimeError(f"Previously recorded archive pin changed for {name}")
    data = fetch(source["url"], 20 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(f"Archive digest mismatch for {name}")
    directory = OUTPUT / f"{name}-{version}"
    directory.mkdir(exist_ok=True)
    notices = []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            parts = Path(member.name).parts
            if not member.isfile() or len(parts) != 2 or not re.match(r"^(licen[cs]e|copying|notice)(\.|$)", parts[-1], re.I):
                continue
            if member.size > 2 * 1024 * 1024:
                raise RuntimeError("Notice exceeds byte budget")
            content = archive.extractfile(member).read()
            destination = directory / parts[-1]
            destination.write_bytes(content)
            notices.append({"archivePath": member.name, "path": str(destination.relative_to(OUTPUT)), "sha256": hashlib.sha256(content).hexdigest()})
    if not notices:
        raise RuntimeError(f"No top-level license notice found for {name}")
    records.append({"name": name, "version": version, "metadataURL": metadata_url, "archiveURL": source["url"], "archiveSha256": expected, "notices": notices})
    print(f"Preserved {name} {version}: {len(notices)} notice(s)", flush=True)
manifest_path.write_text(json.dumps(records, indent=2) + "\n")

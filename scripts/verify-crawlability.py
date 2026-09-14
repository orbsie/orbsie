#!/usr/bin/env python3
"""Verify returned crawler HTML and assets; no browser or model calls."""
import argparse
import json
import struct
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.canonicals = []
        self.title = ""
        self.headings = []
        self.in_title = False
        self.in_heading = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = attrs.get("name") or attrs.get("property")
            if key:
                self.meta[key] = attrs.get("content", "")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonicals.append(attrs.get("href"))
        self.in_title |= tag == "title"
        if tag == "h1":
            self.in_heading = True
            self.headings.append("")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "h1":
            self.in_heading = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_heading:
            self.headings[-1] += data


args = argparse.ArgumentParser()
args.add_argument("--base", required=True)
args.add_argument("--output", required=True)
args.add_argument("--share-path")
args.add_argument("--source", required=True)
options = args.parse_args()
base = options.base.rstrip("/")


def fetch(path, expected=200):
    request = urllib.request.Request(base + path, headers={"User-Agent": "Twitterbot/1.0"})
    try:
        response = urllib.request.urlopen(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, (path, response.status)
    content = response.read(2 * 1024 * 1024 + 1)
    assert len(content) <= 2 * 1024 * 1024
    return content, response.headers.get("Content-Type", "")


html, content_type = fetch("/")
assert "text/html" in content_type
home = Page()
home.feed(html.decode())
assert home.title == "Orbsie — A little world, made by you"
assert len(home.canonicals) == 1 and home.canonicals[0] in ("https://orbsie.com", "https://orbsie.com/")
assert any(heading.strip() for heading in home.headings)
assert "Create, play, and share" in home.meta["description"]
assert home.meta["og:title"] == home.title
assert home.meta["og:image"] == "https://orbsie.com/social-preview.png"
assert home.meta["twitter:card"] == "summary_large_image"
robots = fetch("/robots.txt")[0].decode()
assert "User-Agent: *" in robots and "Allow: /" in robots
assert "Disallow: /api/" in robots and "Disallow: /o/" not in robots
assert "Sitemap: https://orbsie.com/sitemap.xml" in robots
sitemap = ET.fromstring(fetch("/sitemap.xml")[0])
locations = [item.text for item in sitemap.findall(".//{*}loc")]
assert locations == ["https://orbsie.com/"]
assert not sitemap.findall(".//{*}lastmod")
png, content_type = fetch("/social-preview.png")
assert "image/png" in content_type and png[:8] == b"\x89PNG\r\n\x1a\n"
dimensions = struct.unpack(">II", png[16:24])
assert dimensions == (int(home.meta["og:image:width"]), int(home.meta["og:image:height"]))
report = {"sourceCommit": options.source, "base": base, "passed": True,
          "providerCalls": 0, "serverRenderedHeading": True,
          "homeCanonical": home.canonicals[0], "sitemapUrls": locations,
          "socialImageDimensions": dimensions, "socialImageBytes": len(png)}
if options.share_path:
    assert options.share_path.startswith("/o/") and "?" not in options.share_path
    share = Page()
    share.feed(fetch(options.share_path)[0].decode())
    assert "noindex" in share.meta["robots"]
    assert share.canonicals == ["https://orbsie.com" + options.share_path]
    assert share.meta["og:url"] == share.canonicals[0]
    assert share.title != home.title and share.meta["description"]
    report["sharedPage"] = {"path": options.share_path, "noindex": True,
                            "ownCanonical": True, "distinctTitle": True}
output = Path(options.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))

"""Discover local frontend resources, revision their URLs, and generate the SW shell."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, unquote
import argparse
import json
import os
import re


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        for attribute in (("href",) if tag == "link" else ("src", "poster")):
            if attributes.get(attribute):
                self.urls.append(attributes[attribute])
        if tag in ("img", "source") and attributes.get("srcset"):
            self.urls.extend(item.strip().split()[0] for item in attributes["srcset"].split(",") if item.strip())


def local_file(public_dir, owner, url):
    try:
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return None
        target = (public_dir / unquote(parsed.path.lstrip("/")) if parsed.path.startswith("/")
                  else owner.parent / unquote(parsed.path)).resolve()
        if target.is_relative_to(public_dir) and target.is_file() and target.name != "sw.js":
            return target
    except (ValueError, OSError):
        return None
    return None


def discover_shell(public_dir):
    public_dir = public_dir.resolve()
    pages = [page for page in public_dir.rglob("*.html")
             if not re.search(r'<meta\b[^>]*http-equiv\s*=\s*["\']?refresh',
                              page.read_text(encoding="utf-8"), re.IGNORECASE)]
    pending, assets = list(pages), set()
    while pending:
        file = pending.pop()
        if file in assets:
            continue
        assets.add(file)
        references = []
        if file.suffix in (".html", ".css", ".js", ".webmanifest"):
            text = file.read_text(encoding="utf-8")
            if file.suffix == ".html":
                parser = PageAssets()
                parser.feed(text)
                references = parser.urls
            elif file.suffix == ".css":
                references = re.findall(r"url\(\s*['\"]?([^'\"\)]+)", text)
                references += re.findall(r"@import\s+['\"]([^'\"]+)", text)
            elif file.suffix == ".js":
                references = re.findall(r"['\"]([^'\"\r\n]+)['\"]", text)
            else:
                references = [icon["src"] for icon in json.loads(text).get("icons", [])]
        pending.extend(target for url in references if (target := local_file(public_dir, file, url)))
    paths = {"/" + file.relative_to(public_dir).as_posix() for file in assets}
    for page in pages:
        relative = page.relative_to(public_dir)
        paths.add("/" if relative.as_posix() == "index.html" else "/" + relative.with_suffix("").as_posix())
    return sorted(paths)


def get_build_id():
    build_id = os.environ.get("FRONTEND_BUILD_ID")
    if not build_id:
        build_id = f"{os.environ['GITHUB_SHA'][:12]}-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}"
    if not re.fullmatch(r"[A-Za-z0-9._-]+", build_id):
        raise SystemExit("Invalid frontend build id")
    return build_id


def revised_url(public_dir, owner, url, build_id):
    target = local_file(public_dir, owner, url)
    if not target or target.suffix == ".html":
        return url
    parsed = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parsed.query) if key != "v"]
    query.append(("v", build_id))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def main():
    arguments = argparse.ArgumentParser()
    mode = arguments.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Check generated resources without revisioning files")
    mode.add_argument("--generate", action="store_true", help="Regenerate only the service worker resource list")
    options = arguments.parse_args()
    public_dir = Path("public").resolve()
    paths = discover_shell(public_dir)
    sw_path = public_dir / "sw.js"
    sw_text = sw_path.read_text(encoding="utf-8")
    generated_shell = "const APP_SHELL_ASSETS = " + json.dumps(paths, indent=2) + ";"
    generated_sw, count = re.subn(r"const APP_SHELL_ASSETS = \[[\s\S]*?\];", lambda _: generated_shell, sw_text, count=1)
    if count != 1:
        raise SystemExit("Missing service worker shell declaration")
    if options.check:
        if generated_sw != sw_text:
            raise SystemExit("Service worker resources are stale; run stamp_frontend_build.py --generate")
        print(f"Checked {len(paths)} frontend shell resources")
        return
    if options.generate:
        sw_path.write_text(generated_sw, encoding="utf-8")
        print(f"Generated {len(paths)} frontend shell resources")
        return
    build_id = get_build_id()
    generated_sw = re.sub(r'const CACHE_NAME = "uartdebug-shell-[^"]+";',
                          f'const CACHE_NAME = "uartdebug-shell-{build_id}";', generated_sw, count=1)
    register_pattern = re.compile(
        r'navigator\.serviceWorker\.register\(\s*["\']/sw\.js(?:\?v=[^"\']*)?["\']'
        r'(?:\s*,\s*\{\s*updateViaCache:\s*["\']none["\']\s*\})?\s*\)')
    registration = f'navigator.serviceWorker.register("/sw.js?v={build_id}", {{ updateViaCache: "none" }})'
    for page in public_dir.rglob("*.html"):
        text = register_pattern.sub(lambda _: registration, page.read_text(encoding="utf-8"))
        text = re.sub(r'(?P<before>\b(?:src|href|poster)=["\'])(?P<url>[^"\']+)(?P<after>["\'])',
                      lambda m: m["before"] + revised_url(public_dir, page, m["url"], build_id) + m["after"], text)
        page.write_text(text, encoding="utf-8")
    manifest_path = public_dir / "manifest.webmanifest"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for icon in manifest.get("icons", []):
            icon["src"] = revised_url(public_dir, manifest_path, icon["src"], build_id)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    sw_path.write_text(generated_sw, encoding="utf-8")
    print(f"Stamped frontend build {build_id}: {len(paths)} generated shell resources")


if __name__ == "__main__":
    main()

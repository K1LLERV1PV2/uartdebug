from pathlib import Path
import os
import re


def get_build_id():
    explicit_build_id = os.environ.get("FRONTEND_BUILD_ID")
    if explicit_build_id:
        return explicit_build_id

    sha = os.environ["GITHUB_SHA"][:12]
    run_id = os.environ["GITHUB_RUN_ID"]
    run_attempt = os.environ["GITHUB_RUN_ATTEMPT"]
    return f"{sha}-{run_id}-{run_attempt}"


def stamp_file(path, replacements):
    text = path.read_text(encoding="utf-8")
    for pattern, replacement in replacements:
        text = pattern.sub(replacement, text)
    path.write_text(text, encoding="utf-8")


def main():
    public_dir = Path("public")
    build_id = get_build_id()

    sw_path = public_dir / "sw.js"
    sw_text = sw_path.read_text(encoding="utf-8")
    sw_text, sw_count = re.subn(
        r'const CACHE_NAME = "uartdebug-shell-[^"]+";',
        f'const CACHE_NAME = "uartdebug-shell-{build_id}";',
        sw_text,
        count=1,
    )
    if sw_count != 1:
        raise SystemExit("Could not stamp public/sw.js CACHE_NAME")
    sw_path.write_text(sw_text, encoding="utf-8")

    register_pattern = re.compile(
        r'navigator\.serviceWorker\.register\(\s*["\']/sw\.js(?:\?v=[^"\']*)?["\']'
        r'(?:\s*,\s*\{\s*updateViaCache:\s*["\']none["\']\s*\})?\s*\)'
    )
    register_replacement = (
        f'navigator.serviceWorker.register("/sw.js?v={build_id}", '
        '{ updateViaCache: "none" })'
    )

    stable_urls = [
        "/manifest.webmanifest",
        "/favicon.ico",
        "/icons/favicon-192.png",
        "/icons/logo-512.png",
        "/icons/apple-touch-icon.png",
    ]
    stable_url_patterns = [
        (
            re.compile(re.escape(stable_url) + r'(?:\?v=[^"\'<\s]*)?'),
            f"{stable_url}?v={build_id}",
        )
        for stable_url in stable_urls
    ]

    stamped_registers = 0
    for html_path in public_dir.glob("*.html"):
        html_text = html_path.read_text(encoding="utf-8")
        html_text, register_count = register_pattern.subn(register_replacement, html_text)
        stamped_registers += register_count
        for pattern, replacement in stable_url_patterns:
            html_text = pattern.sub(replacement, html_text)
        html_path.write_text(html_text, encoding="utf-8")

    manifest_path = public_dir / "manifest.webmanifest"
    if manifest_path.exists():
        stamp_file(manifest_path, stable_url_patterns[2:])

    if stamped_registers == 0:
        raise SystemExit("No service worker registrations were stamped")

    print(f"Stamped frontend build id: {build_id}")


if __name__ == "__main__":
    main()

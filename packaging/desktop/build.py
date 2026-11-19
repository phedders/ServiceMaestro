#!/usr/bin/env python3
"""
Build portable Service Maestro desktop packages.

The runtime bundles the official Node.js executable, the compiled application
and a small Go launcher. The launcher chooses free localhost ports, keeps data
in the platform's user data folder, opens the browser and stops the server when
the launcher exits.

Examples:
  python3 packaging/desktop/build.py --target windows-x64
  python3 packaging/desktop/build.py --target macos-arm64 --target macos-x64
  python3 packaging/desktop/build.py --target all
"""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "packaging" / "desktop"
LAUNCHER_SRC = DESKTOP / "launcher"
ICON_SVG = ROOT / "packages" / "control" / "public" / "icon.svg"
DEFAULT_OUTPUT = ROOT / "dist" / "desktop"
DEFAULT_CACHE = ROOT / "dist" / "cache"

TARGETS = {
    "windows-x64": {
        "goos": "windows",
        "goarch": "amd64",
        "node": "win-x64",
        "kind": "windows",
    },
    "macos-arm64": {
        "goos": "darwin",
        "goarch": "arm64",
        "node": "darwin-arm64",
        "kind": "macos",
    },
    "macos-x64": {
        "goos": "darwin",
        "goarch": "amd64",
        "node": "darwin-x64",
        "kind": "macos",
    },
    "linux-x64": {
        "goos": "linux",
        "goarch": "amd64",
        "node": "linux-x64",
        "kind": "linux",
    },
}
DEFAULT_TARGETS = ["windows-x64", "macos-arm64", "macos-x64"]


def run(command: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print("+ " + " ".join(str(part) for part in command))
    subprocess.run(command, cwd=cwd or ROOT, env=env, check=True)


def package_version() -> str:
    data = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return str(data.get("version") or "0.0.0")


def node_version() -> str:
    result = subprocess.run(
        ["node", "--version"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip().lstrip("v")


def sanitize_version(value: str) -> str:
    return value.lstrip("v").replace(" ", "-")


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return
    print(f"Downloading {url}")
    temporary = destination.with_suffix(destination.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    temporary.replace(destination)


def stage_app_runtime(work: Path, version: str) -> Path:
    app_root = work / "app-runtime"
    app_root.mkdir(parents=True, exist_ok=True)
    for name in ("package.json", "package-lock.json"):
        shutil.copy2(ROOT / name, app_root / name)
    shutil.copytree(ROOT / "packages", app_root / "packages", symlinks=True)
    print("Copying production dependency tree…")
    shutil.copytree(ROOT / "node_modules", app_root / "node_modules", symlinks=True)

    # The control workspace is only needed at build time. Removing it from the
    # staging workspace lets npm prune drop the React/Vite dependency tree.
    package = json.loads((app_root / "package.json").read_text(encoding="utf-8"))
    package["workspaces"] = ["packages/shared", "packages/server"]
    package["name"] = "service-maestro-desktop-runtime"
    package["private"] = True
    (app_root / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    run(
        ["npm", "prune", "--omit=dev", "--no-audit", "--no-fund"],
        cwd=app_root,
    )

    # Keep only files needed at runtime.
    for package_name, keep in {
        "shared": {"dist", "package.json"},
        "server": {"dist", "package.json"},
        "control": {"dist"},
    }.items():
        package_dir = app_root / "packages" / package_name
        if not package_dir.exists():
            continue
        for child in list(package_dir.iterdir()):
            if child.name in keep:
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

    display_dir = app_root / "packages" / "display"
    if display_dir.exists():
        for child in display_dir.iterdir():
            if child.name == "README.md":
                continue

    node_modules = app_root / "node_modules"
    # Workspace links cannot be represented reliably in ZIP files on Windows.
    for package_name in ("shared", "server"):
        link = node_modules / "@sm" / package_name
        source = app_root / "packages" / package_name
        if link.is_symlink():
            link.unlink()
        elif link.exists():
            shutil.rmtree(link)
        link.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, link, symlinks=True)
    for unwanted in ("@sm/control", ".bin"):
        target = node_modules / unwanted
        if target.is_symlink():
            target.unlink()
        elif target.exists():
            shutil.rmtree(target)

    (app_root / "version.txt").write_text(version + "\n", encoding="utf-8")
    return app_root


def node_runtime(cache: Path, version: str, platform: str) -> tuple[Path, Path | None]:
    node_dir = cache / f"node-v{version}-{platform}"
    node_dir.mkdir(parents=True, exist_ok=True)
    if platform.startswith("win-"):
        node_path = node_dir / "node.exe"
        download(
            f"https://nodejs.org/dist/v{version}/{platform}/node.exe",
            node_path,
        )
        license_path = node_dir / "NODE-LICENSE.txt"
        download(f"https://raw.githubusercontent.com/nodejs/node/v{version}/LICENSE", license_path)
        return node_path, license_path

    node_path = node_dir / "node"
    if not node_path.exists():
        archive = node_dir / f"node-v{version}-{platform}.tar.gz"
        download(
            f"https://nodejs.org/dist/v{version}/node-v{version}-{platform}.tar.gz",
            archive,
        )
        with tarfile.open(archive, "r:gz") as tar:
            member_name = f"node-v{version}-{platform}/bin/node"
            member = tar.getmember(member_name)
            with tar.extractfile(member) as source, node_path.open("wb") as output:
                assert source is not None
                shutil.copyfileobj(source, output)
        node_path.chmod(0o755)
    license_path = node_dir / "NODE-LICENSE.txt"
    download(f"https://raw.githubusercontent.com/nodejs/node/v{version}/LICENSE", license_path)
    return node_path, license_path


def build_launcher(target: dict[str, str], destination: Path, version: str) -> None:
    env = dict(os.environ)
    env["GOOS"] = target["goos"]
    env["GOARCH"] = target["goarch"]
    env["CGO_ENABLED"] = "0"
    run(
        [
            "go",
            "build",
            "-trimpath",
            "-ldflags",
            f"-s -w -X main.version={version}",
            "-o",
            str(destination),
            ".",
        ],
        cwd=LAUNCHER_SRC,
        env=env,
    )


def generate_icons(work: Path) -> tuple[Path | None, Path | None]:
    converter = shutil.which("magick") or shutil.which("convert")
    if not converter:
        print("ImageMagick not found; skipping application icons.", file=sys.stderr)
        return None, None
    icon_dir = work / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    png = icon_dir / "icon.png"
    run([converter, "-background", "none", str(ICON_SVG), "-resize", "1024x1024", str(png)])
    ico = icon_dir / "ServiceMaestro.ico"
    run(
        [
            converter,
            str(png),
            "-define",
            "icon:auto-resize=256,128,64,48,32,16",
            str(ico),
        ]
    )

    sizes = {
        "icp4": 16,
        "icp5": 32,
        "icp6": 64,
        "ic07": 128,
        "ic08": 256,
        "ic09": 512,
        "ic10": 1024,
    }
    chunks: list[bytes] = []
    for kind, size in sizes.items():
        resized = icon_dir / f"icon-{size}.png"
        run([converter, str(png), "-resize", f"{size}x{size}", str(resized)])
        data = resized.read_bytes()
        chunks.append(kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    icns = icon_dir / "icon.icns"
    icns.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    return ico, icns


def copy_runtime(destination: Path, app_root: Path, node_path: Path, license_path: Path | None) -> None:
    shutil.copytree(app_root, destination / "app")
    (destination / "runtime").mkdir(parents=True, exist_ok=True)
    node_name = "node.exe" if node_path.suffix == ".exe" else "node"
    shutil.copy2(node_path, destination / "runtime" / node_name)
    if license_path and license_path.exists():
        shutil.copy2(license_path, destination / "runtime" / "NODE-LICENSE.txt")


def readme_windows(version: str) -> str:
    return f"""Service Maestro {version} for Windows
========================================

Quick start
-----------
1. Run "Service Maestro.exe" to start it and open the browser.
   Or run "Install Service Maestro.cmd" to add Desktop and Start Menu shortcuts.
2. Your browser opens the local Service Maestro login page.
3. The first-run admin password is stored in:
   %LOCALAPPDATA%\\ServiceMaestro\\credentials.txt
4. Use "Stop Service Maestro.cmd" or close the launcher window to stop.

Data and logs
-------------
Data:  %LOCALAPPDATA%\\ServiceMaestro
Logs:  %LOCALAPPDATA%\\ServiceMaestro\\logs\\service-maestro.log

The server listens only on 127.0.0.1 by default and uses HTTP on localhost for
the desktop build, avoiding self-signed certificate warnings. Set
SM_SSL_ENABLED=true if you need HTTPS. Service Maestro is packaged with its own
Node.js runtime; no separate Node.js or Docker installation is needed. Git-backed
sync is disabled by default because Git is not bundled.

The ZIP is not code-signed. If Windows SmartScreen appears, choose More info and
then Run anyway. Sign the installer/launcher before distributing it widely.

Advanced configuration
----------------------
Set environment variables before starting the launcher, for example:
  SM_HOST=0.0.0.0
  SM_PORT=8080
  SM_GIT_ENABLED=true

Do not expose this desktop build to the internet without configuring HTTPS,
authentication and the normal production deployment settings.
"""


def readme_macos(version: str) -> str:
    return f"""Service Maestro {version} for macOS
=====================================

Install
-------
1. Open the ZIP and drag "Service Maestro.app" to Applications.
2. Double-click Service Maestro. If macOS blocks the unsigned app, right-click
   it and choose Open the first time.
3. A small dialog shows the local URL and login details. Choose "Open Browser".
4. Choose "Quit Service Maestro" in that dialog to stop the server.

Data and logs
-------------
Data:  ~/Library/Application Support/Service Maestro
Logs:  ~/Library/Application Support/Service Maestro/logs/service-maestro.log

The first-run admin password is in:
  ~/Library/Application Support/Service Maestro/credentials.txt

The server listens only on localhost by default and uses HTTP on localhost for
the desktop build, avoiding self-signed certificate warnings. Set
SM_SSL_ENABLED=true if you need HTTPS. Service Maestro is packaged with its own
Node.js runtime; no separate Node.js or Docker installation is needed. Git-backed
sync is disabled by default because Git is not bundled.

The ZIP is not code-signed/notarized. Right-click Open the first time if macOS
blocks it. Sign and notarize the app before distributing it widely.

Advanced configuration
----------------------
Set environment variables in the shell before launching the app, for example:
  SM_HOST=0.0.0.0
  SM_GIT_ENABLED=true

Do not expose this desktop build to the internet without configuring HTTPS,
authentication and the normal production deployment settings.
"""


def build_windows(
    work: Path,
    target_name: str,
    target: dict[str, str],
    app_root: Path,
    node_path: Path,
    license_path: Path | None,
    version: str,
    output: Path,
    icons: tuple[Path | None, Path | None],
) -> Path:
    destination = work / f"ServiceMaestro-{target_name}"
    destination.mkdir(parents=True)
    copy_runtime(destination, app_root, node_path, license_path)
    build_launcher(target, destination / "ServiceMaestro.exe", version)
    if icons[0]:
        shutil.copy2(icons[0], destination / "ServiceMaestro.ico")
    for name in (
        "Install Service Maestro.cmd",
        "install.ps1",
        "Stop Service Maestro.cmd",
        "Uninstall Service Maestro.cmd",
        "uninstall.ps1",
    ):
        shutil.copy2(DESKTOP / "windows" / name, destination / name)
    (destination / "README.txt").write_text(readme_windows(version), encoding="utf-8")
    (destination / "version.txt").write_text(version + "\n", encoding="utf-8")
    archive = output / f"ServiceMaestro-windows-x64.zip"
    make_zip(destination, archive)
    return archive


def build_macos(
    work: Path,
    target_name: str,
    target: dict[str, str],
    app_root: Path,
    node_path: Path,
    license_path: Path | None,
    version: str,
    output: Path,
    icons: tuple[Path | None, Path | None],
) -> Path:
    app = work / f"ServiceMaestro-{target_name}-app" / "Service Maestro.app"
    contents = app / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True)
    resources.mkdir(parents=True)
    copy_runtime(resources, app_root, node_path, license_path)
    build_launcher(target, macos / "ServiceMaestro", version)
    (macos / "ServiceMaestro").chmod(0o755)
    if icons[1]:
        shutil.copy2(icons[1], resources / "icon.icns")
    info = {
        "CFBundleName": "Service Maestro",
        "CFBundleDisplayName": "Service Maestro",
        "CFBundleIdentifier": "dev.servicemaestro.desktop",
        "CFBundleExecutable": "ServiceMaestro",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "CFBundleIconFile": "icon.icns" if icons[1] else "",
        "LSMinimumSystemVersion": "11.0",
        "LSUIElement": True,
        "NSHighResolutionCapable": True,
    }
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    (app.parent / "README.txt").write_text(readme_macos(version), encoding="utf-8")
    archive = output / f"ServiceMaestro-macos-{target_name.split('-', 1)[1]}.zip"
    make_zip_contents(app.parent, archive)
    return archive


def build_linux(
    work: Path,
    target_name: str,
    target: dict[str, str],
    app_root: Path,
    node_path: Path,
    license_path: Path | None,
    version: str,
    output: Path,
) -> Path:
    destination = work / f"ServiceMaestro-{target_name}"
    destination.mkdir(parents=True)
    copy_runtime(destination, app_root, node_path, license_path)
    build_launcher(target, destination / "ServiceMaestro", version)
    (destination / "README.txt").write_text(
        f"Service Maestro {version}\n\nRun ./ServiceMaestro and open the URL it prints.\n"
        f"Data is stored under ~/.config/service-maestro unless SM_DESKTOP_DATA_DIR is set.\n",
        encoding="utf-8",
    )
    archive = output / f"ServiceMaestro-linux-x64.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(destination, arcname=destination.name)
    return archive


def make_zip(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_dir():
                continue
            relative = path.relative_to(source.parent)
            add_zip_file(archive, path, relative)


def make_zip_contents(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_dir():
                continue
            relative = path.relative_to(source)
            add_zip_file(archive, path, relative)


def add_zip_file(archive: zipfile.ZipFile, path: Path, relative: Path) -> None:
    info = zipfile.ZipInfo.from_file(path, relative.as_posix())
    info.compress_type = zipfile.ZIP_DEFLATED
    if path.name.endswith((".exe", ".node")) or os.access(path, os.X_OK):
        info.external_attr = (0o755 & 0xFFFF) << 16
    else:
        info.external_attr = (0o644 & 0xFFFF) << 16
    with path.open("rb") as handle:
        archive.writestr(info, handle.read(), compresslevel=9)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Service Maestro desktop packages")
    parser.add_argument(
        "--target",
        action="append",
        choices=["all", *TARGETS.keys()],
        help="Target to build; repeatable. Default: all Windows/macOS targets.",
    )
    parser.add_argument(
        "--version",
        default=os.environ.get("VERSION"),
        help="Package version (default: VERSION environment or package.json)",
    )
    parser.add_argument("--node-version", default=None, help="Node runtime version (default: installed node)")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE))
    parser.add_argument("--no-build", action="store_true", help="Reuse the existing dist build")
    parser.add_argument("--keep-work", action="store_true", help="Keep the temporary staging folder")
    args = parser.parse_args()

    selected = args.target or DEFAULT_TARGETS
    if "all" in selected:
        selected = DEFAULT_TARGETS

    version = args.version or package_version()
    node_ver = args.node_version or node_version()
    output = Path(args.output_dir).resolve()
    cache = Path(args.cache_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    if not args.no_build:
        run(["npm", "run", "build"])
    for required in (
        ROOT / "packages" / "server" / "dist" / "index.js",
        ROOT / "packages" / "control" / "dist" / "index.html",
        ROOT / "packages" / "shared" / "dist" / "index.js",
    ):
        if not required.exists():
            raise SystemExit(f"Missing build output {required}; run npm run build first")

    work = Path(tempfile.mkdtemp(prefix="sm-desktop-"))
    print(f"Staging in {work}")
    try:
        app_root = stage_app_runtime(work, version)
        icons = generate_icons(work)
        archives: list[Path] = []
        for target_name in selected:
            target = TARGETS[target_name]
            print(f"\n=== {target_name} ===")
            node_path, license_path = node_runtime(cache, node_ver, target["node"])
            if target["kind"] == "windows":
                archives.append(
                    build_windows(
                        work, target_name, target, app_root, node_path, license_path,
                        version, output, icons,
                    )
                )
            elif target["kind"] == "macos":
                archives.append(
                    build_macos(
                        work, target_name, target, app_root, node_path, license_path,
                        version, output, icons,
                    )
                )
            else:
                archives.append(
                    build_linux(
                        work, target_name, target, app_root, node_path, license_path,
                        version, output,
                    )
                )
        print("\nBuilt:")
        for archive in archives:
            print(f"  {archive} ({archive.stat().st_size / (1024 * 1024):.1f} MiB)")
        return 0
    finally:
        if args.keep_work:
            print(f"Keeping staging folder: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())

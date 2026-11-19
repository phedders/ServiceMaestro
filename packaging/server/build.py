#!/usr/bin/env python3
"""
Build Debian, RPM and source RPM packages for the Service Maestro server.

The package bundles the official Node.js Linux runtime and the compiled
application, then installs a systemd service.

Examples:
  python3 packaging/server/build.py
  python3 packaging/server/build.py --no-build
  python3 packaging/server/build.py --format deb
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "packaging" / "server"
DEFAULT_OUTPUT = ROOT / "dist" / "server"
DEFAULT_CACHE = ROOT / "dist" / "cache"
PACKAGE = "service-maestro-server"


def load_desktop_builder():
    path = ROOT / "packaging" / "desktop" / "build.py"
    spec = importlib.util.spec_from_file_location("sm_desktop_build", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def deb_version(value: str) -> str:
    return value.lstrip("v").replace("-", "~")


def prepare_payload(
    work: Path,
    app_root: Path,
    node_path: Path,
    license_path: Path | None,
) -> Path:
    payload = work / "payload"
    payload.mkdir(parents=True)
    shutil.copytree(app_root, payload / "app")
    (payload / "runtime").mkdir(parents=True)
    shutil.copy2(node_path, payload / "runtime" / "node")
    (payload / "runtime" / "node").chmod(0o755)
    if license_path and license_path.exists():
        shutil.copy2(license_path, payload / "runtime" / "NODE-LICENSE.txt")
    for name in ("service-maestro.service", "service-maestro.env", "config.yaml", "README.package"):
        shutil.copy2(SERVER / name, payload / name)
    return payload


def write_file(path: Path, data: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data, encoding="utf-8")
    path.chmod(mode)


def build_deb(work: Path, payload: Path, version: str, output: Path) -> Path:
    root = work / "deb-root"
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    install = root

    shutil.copytree(payload / "app", install / "usr/lib/service-maestro/app")
    shutil.copytree(payload / "runtime", install / "usr/lib/service-maestro/runtime")
    (install / "usr/lib/systemd/system").mkdir(parents=True, exist_ok=True)
    shutil.copy2(
        payload / "service-maestro.service",
        install / "usr/lib/systemd/system/service-maestro.service",
    )
    (install / "etc/service-maestro").mkdir(parents=True, exist_ok=True)
    shutil.copy2(payload / "service-maestro.env", install / "etc/service-maestro/service-maestro.env")
    shutil.copy2(payload / "config.yaml", install / "etc/service-maestro/config.yaml")
    (install / "usr/share/doc/service-maestro-server").mkdir(parents=True, exist_ok=True)
    shutil.copy2(
        payload / "README.package",
        install / "usr/share/doc/service-maestro-server/README.md",
    )

    for directory in (
        "var/lib/service-maestro/data",
        "var/lib/service-maestro/ssl",
        "var/lib/service-maestro/imports/songselect",
        "var/lib/service-maestro/library/songs",
        "var/lib/service-maestro/library/bible",
        "var/lib/service-maestro/library/images",
    ):
        (install / directory).mkdir(parents=True, exist_ok=True)

    # Keep package files read-only apart from the bundled Node executable.
    for path in install.rglob("*"):
        if path.is_dir():
            path.chmod(0o755)
        elif path.name == "node":
            path.chmod(0o755)
        else:
            path.chmod(0o644)
    (install / "etc/service-maestro/service-maestro.env").chmod(0o640)

    debian = root / "DEBIAN"
    debian.mkdir()
    installed_size = sum(
        path.stat().st_size for path in install.rglob("*") if path.is_file()
    ) // 1024
    control = (SERVER / "debian" / "control.in").read_text(encoding="utf-8")
    control = control.replace("@VERSION@", deb_version(version))
    control = control.replace("@INSTALLED_SIZE@", str(installed_size))
    write_file(debian / "control", control)
    shutil.copy2(SERVER / "debian" / "conffiles", debian / "conffiles")
    for script in ("postinst", "prerm", "postrm"):
        shutil.copy2(SERVER / "debian" / script, debian / script)
        (debian / script).chmod(0o755)
    md5 = subprocess.run(
        "find usr etc var -type f -print0 | sort -z | xargs -0 md5sum",
        cwd=root,
        shell=True,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    write_file(debian / "md5sums", md5)

    package = output / f"{PACKAGE}_{deb_version(version)}_amd64.deb"
    run(["dpkg-deb", "--root-owner-group", "--build", str(root), str(package)])
    return package


def build_rpm(work: Path, payload: Path, version: str, output: Path) -> tuple[Path, Path]:
    rpmtop = work / "rpmbuild"
    for name in ("BUILD", "BUILDROOT", "RPMS", "SOURCES", "SPECS", "SRPMS"):
        (rpmtop / name).mkdir(parents=True, exist_ok=True)

    source_root = work / "source-root"
    if source_root.exists():
        shutil.rmtree(source_root)
    source_root.mkdir()
    for child in payload.iterdir():
        destination = source_root / child.name
        if child.is_dir():
            shutil.copytree(child, destination)
        else:
            shutil.copy2(child, destination)

    source_name = f"{PACKAGE}-{version}"
    source_tar = rpmtop / "SOURCES" / f"{source_name}.tar.gz"
    with tarfile.open(source_tar, "w:gz") as tar:
        for child in source_root.iterdir():
            tar.add(child, arcname=f"{source_name}/{child.name}")

    spec = (SERVER / "service-maestro-server.spec.in").read_text(encoding="utf-8")
    spec = spec.replace("@VERSION@", version)
    spec_path = rpmtop / "SPECS" / f"{PACKAGE}.spec"
    write_file(spec_path, spec)

    run(
        [
            "rpmbuild",
            "--define",
            f"_topdir {rpmtop}",
            "-ba",
            str(spec_path),
        ]
    )
    binary = next((rpmtop / "RPMS" / "x86_64").glob("*.rpm"))
    source = next((rpmtop / "SRPMS").glob("*.src.rpm"))
    output.mkdir(parents=True, exist_ok=True)
    binary_out = output / binary.name
    source_out = output / source.name
    shutil.copy2(binary, binary_out)
    shutil.copy2(source, source_out)
    return binary_out, source_out


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Service Maestro server packages")
    parser.add_argument("--version", default=os.environ.get("VERSION"), help="Package version")
    parser.add_argument("--node-version", default=None, help="Node runtime version")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE))
    parser.add_argument("--format", choices=["all", "deb", "rpm"], default="all")
    parser.add_argument("--no-build", action="store_true", help="Reuse the existing dist build")
    parser.add_argument("--keep-work", action="store_true", help="Keep the staging folder")
    args = parser.parse_args()

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

    desktop = load_desktop_builder()
    work = Path(tempfile.mkdtemp(prefix="sm-server-package-"))
    print(f"Staging in {work}")
    try:
        app_root = desktop.stage_app_runtime(work, version)
        node_path, license_path = desktop.node_runtime(cache, node_ver, "linux-x64")
        payload = prepare_payload(work, app_root, node_path, license_path)
        built: list[Path] = []
        if args.format in ("all", "deb"):
            built.append(build_deb(work, payload, version, output))
        if args.format in ("all", "rpm"):
            built.extend(build_rpm(work, payload, version, output))
        print("\nBuilt:")
        for package in built:
            print(f"  {package} ({package.stat().st_size / (1024 * 1024):.1f} MiB)")
        return 0
    finally:
        if args.keep_work:
            print(f"Keeping staging folder: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())

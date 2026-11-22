# Native Linux server packages

Service Maestro can be installed as a native Debian or RPM package instead of a
container. The packages bundle the official Node.js Linux runtime, the compiled
application and a systemd service. No system Node.js installation is required.

## Build

```sh
make server-packages
```

Outputs:

```text
dist/server/service-maestro-server_<version>_amd64.deb
dist/server/service-maestro-server-<version>-1.x86_64.rpm
dist/server/service-maestro-server-<version>-1.src.rpm
```

Individual formats:

```sh
make server-deb
make server-rpm
```

The build requires Node.js 24, Python 3.8+, `dpkg-deb` and `rpmbuild`. It reuses
the bundled Node.js runtime and `better-sqlite3` prebuilt binaries.

## Install from Debian/Ubuntu

```sh
sudo apt install ./dist/server/service-maestro-server_0.3.0_amd64.deb
```

## Install from RPM

On Fedora/RHEL-compatible systems:

```sh
sudo dnf install ./dist/server/service-maestro-server-0.3.0-1.x86_64.rpm
```

Or:

```sh
sudo rpm -Uvh ./dist/server/service-maestro-server-0.3.0-1.x86_64.rpm
```

## First start

The package creates the service user, data directories and first-run secrets,
then enables and starts `service-maestro.service`.

```sh
systemctl status service-maestro
journalctl -u service-maestro -f
```

The initial administrator password is generated at:

```text
/etc/service-maestro/admin-password
```

The output token is generated at:

```text
/etc/service-maestro/output-token
```

Log in as `admin` at `https://<server>:8080` and change the password in the web UI.
The generated password is only used when the admin account is first created.

Remove or protect the initial credentials file after saving the password if you
do not want it to remain on disk.

## Configuration

Environment:

```text
/etc/service-maestro/service-maestro.env
```

YAML configuration:

```text
/etc/service-maestro/config.yaml
```

Data, SSL files, uploads and media:

```text
/var/lib/service-maestro
```

Default listeners:

- Control UI and API: HTTPS port `8080`
- Read-only display listener: HTTP port `8081`, path `/display/`

After editing the environment file:

```sh
sudo systemctl restart service-maestro
```

The server generates a local self-signed HTTPS certificate on first start. Install
a trusted certificate and set `SM_SSL_CERT_FILE` / `SM_SSL_KEY_FILE` for production
use.

The package depends on `git` and `openssl`; Git-backed song/set-list sync is enabled
by default. Install `git-lfs` if you use LFS in the Bibles repository.

## Upgrade

Install the newer `.deb` or `.rpm` normally. The package preserves:

- `/var/lib/service-maestro`
- `/etc/service-maestro/service-maestro.env` and `config.yaml` (config files are
  treated as conffiles/noreplace)
- generated admin password and output token

The service is restarted by the package scripts.

## Remove and purge

Debian/Ubuntu:

```sh
sudo apt remove service-maestro-server   # keeps configuration and data
sudo apt purge service-maestro-server    # also removes configuration and data
```

RPM:

```sh
sudo dnf remove service-maestro-server   # package files; data directories remain
```

RPM removal does not run a data purge. Delete `/var/lib/service-maestro` manually
for a complete reset.

## Build and inspect the source RPM

The source RPM contains the packaged runtime, application payload, systemd unit
and spec file:

```sh
rpm -qip dist/server/service-maestro-server-0.3.0-1.src.rpm
rpmbuild --rebuild dist/server/service-maestro-server-0.3.0-1.src.rpm
```

## Hosted APT and DNF repositories

The [Service Maestro Packages](https://github.com/phedders/ServiceMaestro-Packages)
repository publishes the latest server and CLI packages through GitHub Pages:

- APT: <https://phedders.github.io/ServiceMaestro-Packages/apt/>
- DNF: <https://phedders.github.io/ServiceMaestro-Packages/rpm/>
- Index: <https://phedders.github.io/ServiceMaestro-Packages/>

Debian/Ubuntu:

```sh
echo "deb [trusted=yes] https://phedders.github.io/ServiceMaestro-Packages/apt ./" | sudo tee /etc/apt/sources.list.d/service-maestro.list
sudo apt update
sudo apt install service-maestro-server service-maestro-cli
```

Fedora/RHEL/Rocky:

```sh
sudo tee /etc/yum.repos.d/service-maestro.repo <<'EOF'
[service-maestro]
name=Service Maestro
baseurl=https://phedders.github.io/ServiceMaestro-Packages/rpm/
enabled=1
gpgcheck=0
EOF
sudo dnf install service-maestro-server
```

The packages are currently unsigned, so APT uses `[trusted=yes]` and DNF uses
`gpgcheck=0`. The site also exposes `SHA256SUMS` and direct package links.

The `Publish package repositories` workflow in this repository refreshes the
`gh-pages` branch after a successful `Release packages` run. It can also be
started manually:

```sh
gh workflow run packages-pages.yml --repo phedders/ServiceMaestro
```

## Publish everything to GHCR

`make publish-all` builds the container image, CLI `.deb`, server `.deb`/`.rpm`/
`.src.rpm` and desktop ZIPs. It then pushes:

- the container image to `ghcr.io/phedders/servicemaestro:<version>` and `:latest`
- a package bundle image to `ghcr.io/phedders/servicemaestro-packages:<version>`
  and `:latest`

```sh
export GHCR_TOKEN=...
make publish-all
```

The package bundle is a scratch OCI image containing all installable files and a
`SHA256SUMS` file. Retrieve it with:

```sh
docker pull ghcr.io/phedders/servicemaestro-packages:0.3.0
id=$(docker create ghcr.io/phedders/servicemaestro-packages:0.3.0)
docker cp "$id:/packages" .
docker rm "$id"
```

Or use OCI tooling such as `skopeo`:

```sh
skopeo copy docker://ghcr.io/phedders/servicemaestro-packages:0.3.0 dir:sm-packages
```


## CI release workflow

`.github/workflows/desktop.yml` runs on `v*` tags and manual dispatch. It builds
the desktop ZIPs, CLI Debian package and the server Debian, RPM and source RPM
packages, uploads them as workflow artifacts and attaches them to the GitHub
release for the tag.

# Service Maestro package bundle

This GHCR image contains the installable Service Maestro packages:

- `service-maestro-cli_<version>_all.deb`
- `service-maestro-server_<version>_amd64.deb`
- `service-maestro-server-<version>-1.x86_64.rpm`
- `service-maestro-server-<version>-1.src.rpm`
- Windows and macOS desktop ZIPs
- `SHA256SUMS`

Pull and extract the bundle:

```sh
docker pull ghcr.io/phedders/servicemaestro-packages:0.3.1
id=$(docker create ghcr.io/phedders/servicemaestro-packages:0.3.1)
docker cp "$id:/packages" .
docker rm "$id"
```

Or use any OCI-compatible tool, for example:

```sh
skopeo copy docker://ghcr.io/phedders/servicemaestro-packages:0.3.1 dir:sm-packages
```

Replace `0.3.1` with the desired release tag. `latest` is also published.

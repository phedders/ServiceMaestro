SHELL := /bin/bash

# Container image published by `make publish`.
IMAGE ?= ghcr.io/phedders/servicemaestro
# OCI artifact image containing the installable packages.
PACKAGES_IMAGE ?= ghcr.io/phedders/servicemaestro-packages
VERSION ?= $(shell node -p "require('./package.json').version")
DEB_VERSION ?= $(subst -,~,$(VERSION))
TAG ?= $(VERSION)
DOCKER ?= docker
GHCR_USER ?= $(if $(GITHUB_ACTOR),$(GITHUB_ACTOR),phedders)
PUBLISH_LATEST ?= 1
PACKAGE_BUNDLE_DIR ?= dist/package-bundle

IMAGE_TAGS = --tag "$(IMAGE):$(TAG)"$(if $(and $(filter 1,$(PUBLISH_LATEST)),$(filter-out latest,$(TAG))), --tag "$(IMAGE):latest")
PACKAGES_IMAGE_TAGS = --tag "$(PACKAGES_IMAGE):$(TAG)"$(if $(and $(filter 1,$(PUBLISH_LATEST)),$(filter-out latest,$(TAG))), --tag "$(PACKAGES_IMAGE):latest")

.PHONY: help image deb desktop desktop-windows desktop-macos server-packages server-deb server-rpm packages all-packages package-bundle package-bundle-image login publish publish-all

help:
	@printf '%s\n' \
		'Service Maestro targets:' \
		'  make image            Build $(IMAGE):$(TAG)' \
		'  make deb              Build the CLI Debian package' \
		'  make server-packages  Build server .deb, .rpm and .src.rpm' \
		'  make server-deb       Build the server Debian package' \
		'  make server-rpm       Build the server RPM and SRPM' \
		'  make packages         Build CLI and server packages' \
		'  make desktop          Build Windows and macOS desktop ZIPs' \
		'  make desktop-windows  Build the Windows desktop ZIP' \
		'  make desktop-macos    Build both macOS desktop ZIPs' \
		'  make all-packages     Build all CLI, server and desktop packages' \
		'  make package-bundle   Collect packages and SHA256SUMS in $(PACKAGE_BUNDLE_DIR)' \
		'  make login            Log in to GHCR using GHCR_TOKEN or GITHUB_TOKEN' \
		'  make publish          Build and push $(IMAGE):$(TAG)$(if $(filter 1,$(PUBLISH_LATEST)), and :latest)' \
		'  make publish-all      Build everything, push the image and package bundle to GHCR' \
		'' \
		'Variables:' \
		'  IMAGE=$(IMAGE)' \
		'  PACKAGES_IMAGE=$(PACKAGES_IMAGE)' \
		'  TAG=$(TAG)' \
		'  VERSION=$(VERSION)' \
		'  DEB_VERSION=$(DEB_VERSION)' \
		'  PUBLISH_LATEST=$(PUBLISH_LATEST)' \
		'  DOCKER=$(DOCKER)' \
		'  GHCR_USER=$(GHCR_USER)'


image:
	@test -n "$(TAG)" || { echo "TAG is empty; set TAG=... or add a version to package.json"; exit 1; }
	$(DOCKER) build \
		--label "org.opencontainers.image.source=https://github.com/phedders/ServiceMaestro" \
		--label "org.opencontainers.image.title=Service Maestro" \
		--label "org.opencontainers.image.version=$(TAG)" \
		$(IMAGE_TAGS) \
		.

deb:
	VERSION="$(VERSION)" "$(CURDIR)/tools/build-deb"

server-packages:
	VERSION="$(VERSION)" python3 packaging/server/build.py

server-deb:
	VERSION="$(VERSION)" python3 packaging/server/build.py --format deb

server-rpm:
	VERSION="$(VERSION)" python3 packaging/server/build.py --format rpm

packages: deb server-packages

desktop:
	VERSION="$(VERSION)" python3 packaging/desktop/build.py

desktop-windows:
	VERSION="$(VERSION)" python3 packaging/desktop/build.py --target windows-x64

desktop-macos:
	VERSION="$(VERSION)" python3 packaging/desktop/build.py --target macos-arm64 --target macos-x64

all-packages: packages desktop

package-bundle: all-packages
	rm -rf "$(PACKAGE_BUNDLE_DIR)"
	mkdir -p "$(PACKAGE_BUNDLE_DIR)"
	cp dist/service-maestro-cli_$(DEB_VERSION)_all.deb "$(PACKAGE_BUNDLE_DIR)/"
	cp dist/server/service-maestro-server_$(DEB_VERSION)_amd64.deb "$(PACKAGE_BUNDLE_DIR)/"
	cp dist/server/service-maestro-server-$(VERSION)-1.x86_64.rpm "$(PACKAGE_BUNDLE_DIR)/"
	cp dist/server/service-maestro-server-$(VERSION)-1.src.rpm "$(PACKAGE_BUNDLE_DIR)/"
	cp dist/desktop/ServiceMaestro-*.zip "$(PACKAGE_BUNDLE_DIR)/"
	cp packaging/packages/README.md "$(PACKAGE_BUNDLE_DIR)/README.md"
	cd "$(PACKAGE_BUNDLE_DIR)" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%f\n' | sort | xargs sha256sum > SHA256SUMS
	@echo "Package bundle: $(PACKAGE_BUNDLE_DIR)"

package-bundle-image: package-bundle
	$(DOCKER) build \
		--label "org.opencontainers.image.source=https://github.com/phedders/ServiceMaestro" \
		--label "org.opencontainers.image.title=Service Maestro packages" \
		--label "org.opencontainers.image.version=$(TAG)" \
		-f packaging/packages/Dockerfile \
		$(PACKAGES_IMAGE_TAGS) \
		"$(PACKAGE_BUNDLE_DIR)"

up: image
	git push
	docker compose up -d

login:
	@TOKEN="$${GHCR_TOKEN:-$${GITHUB_TOKEN:-}}"; \
	if [ -z "$$TOKEN" ]; then \
		echo 'Set GHCR_TOKEN or GITHUB_TOKEN to a GitHub token that can write packages.'; \
		echo 'Example: read -rsp "GHCR token: " GHCR_TOKEN; echo'; \
		exit 1; \
	fi; \
	printf '%s' "$$TOKEN" | $(DOCKER) login ghcr.io --username "$(GHCR_USER)" --password-stdin

publish: image
	git push
	@TOKEN="$${GHCR_TOKEN:-$${GITHUB_TOKEN:-}}"; \
	if [ -n "$$TOKEN" ]; then \
		printf '%s' "$$TOKEN" | $(DOCKER) login ghcr.io --username "$(GHCR_USER)" --password-stdin; \
	fi
	$(DOCKER) push "$(IMAGE):$(TAG)"
	@if [ "$(PUBLISH_LATEST)" = "1" ] && [ "$(TAG)" != "latest" ]; then \
		$(DOCKER) push "$(IMAGE):latest"; \
	fi
	@echo "Published $(IMAGE):$(TAG)"

publish-all: image package-bundle package-bundle-image
	git push
	@TOKEN="$${GHCR_TOKEN:-$${GITHUB_TOKEN:-}}"; \
	if [ -n "$$TOKEN" ]; then \
		printf '%s' "$$TOKEN" | $(DOCKER) login ghcr.io --username "$(GHCR_USER)" --password-stdin; \
	fi
	$(DOCKER) push "$(IMAGE):$(TAG)"
	$(DOCKER) push "$(PACKAGES_IMAGE):$(TAG)"
	@if [ "$(PUBLISH_LATEST)" = "1" ] && [ "$(TAG)" != "latest" ]; then \
		$(DOCKER) push "$(IMAGE):latest"; \
		$(DOCKER) push "$(PACKAGES_IMAGE):latest"; \
	fi
	@echo "Published $(IMAGE):$(TAG) and $(PACKAGES_IMAGE):$(TAG)"

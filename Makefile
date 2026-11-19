SHELL := /bin/bash

# Container image published by `make publish`.
IMAGE ?= ghcr.io/phedders/servicemaestro
VERSION ?= $(shell node -p "require('./package.json').version")
TAG ?= $(VERSION)
DOCKER ?= docker
GHCR_USER ?= $(if $(GITHUB_ACTOR),$(GITHUB_ACTOR),phedders)
PUBLISH_LATEST ?= 1

IMAGE_TAGS = --tag "$(IMAGE):$(TAG)"$(if $(and $(filter 1,$(PUBLISH_LATEST)),$(filter-out latest,$(TAG))), --tag "$(IMAGE):latest")

.PHONY: help image deb login publish

help:
	@printf '%s\n' \
		'Service Maestro targets:' \
		'  make image    Build $(IMAGE):$(TAG)' \
		'  make deb      Build dist/service-maestro-cli_$(VERSION)_all.deb' \
		'  make login    Log in to GHCR using GHCR_TOKEN or GITHUB_TOKEN' \
		'  make publish  Build and push $(IMAGE):$(TAG)$(if $(filter 1,$(PUBLISH_LATEST)), and :latest)' \
		'' \
		'Variables:' \
		'  IMAGE=$(IMAGE)' \
		'  TAG=$(TAG)' \
		'  VERSION=$(VERSION)' \
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

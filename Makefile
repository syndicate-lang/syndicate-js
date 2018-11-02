MAKEABLE_PACKAGES=syntax driver-timer syntax-playground

all:
	for p in $(MAKEABLE_PACKAGES); do $(MAKE) -C packages/$$p; done

bootstrap:
	npx lerna bootstrap

.PHONY: bootstrap

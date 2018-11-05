MAKEABLE_PACKAGES=\
	syntax \
	driver-timer \
	driver-browser-ui \
	driver-http-node \
	driver-websocket \
	syntax-playground

all:
	for p in $(MAKEABLE_PACKAGES); do $(MAKE) -C packages/$$p; done

clean:
	for p in $(MAKEABLE_PACKAGES); do $(MAKE) -C packages/$$p clean; done

bootstrap:
	npx lerna bootstrap

.PHONY: bootstrap

bootstrap: node_modules/lerna

node_modules/lerna:
	npm i .
	$(MAKE) clean
	+$(MAKE) -j$$(nproc) all

PACKAGE_JSONS=$(wildcard packages/*/package.json)
PACKAGE_DIRS=$(PACKAGE_JSONS:/package.json=)

all clean veryclean:
	+for d in $(PACKAGE_DIRS); do make -C $$d $@ & done; wait

watch:
	inotifytest make -j$$(nproc) all

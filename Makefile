bootstrap: node_modules/lerna

node_modules/lerna:
	npm i .
	$(MAKE) clean
	+$(MAKE) -j$$(nproc) all

PACKAGE_JSONS=$(wildcard packages/*/package.json)
PACKAGE_DIRS=$(PACKAGE_JSONS:/package.json=)

clean veryclean:
	rm -f deps.mk
	for d in $(PACKAGE_DIRS); do make -C $$d $@; done

all: $(PACKAGE_DIRS:=/.phony_all)

include deps.mk

deps.mk:
	for d in $(PACKAGE_DIRS); do \
		echo $$d/.phony_all: $$(fgrep 'file:' "$$d/package.json" | sed -e 's:.*/\([^/"]*\)",:packages/\1/.phony_all:'); \
	done > $@

%/.phony_all:
	+$(MAKE) -C $* all

watch:
	inotifytest make -j$$(nproc) all

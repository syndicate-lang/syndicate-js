dist/main.js: lib $(wildcard lib/*.js)
	mkdir -p dist
	npx webpack

lib: $(wildcard src/*.js)
	mkdir -p $@
	npx syndicate-babel src --out-dir $@

clean:
	rm -rf lib
	rm -rf dist

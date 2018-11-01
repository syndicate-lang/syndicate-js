lib: $(wildcard src/*.js)
	mkdir -p $@
	npx syndicate-babel src --out-dir $@

clean:
	rm -rf lib

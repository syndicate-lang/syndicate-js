lib: $(wildcard src/*.js)
	mkdir -p $@
	npx babel src --out-dir $@

clean:
	rm -rf lib

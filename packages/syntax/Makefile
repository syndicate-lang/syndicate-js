.PHONY: build

build:
	mkdir -p lib
	cat node_modules/@babel/parser/lib/index.js babel_parser_suffix.js > lib/babel_parser.js
	npx babel src --out-dir lib

clean:
	rm -rf lib

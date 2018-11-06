exec >&2
redo-ifchange lib/babel_parser.js
for d in src/*.js; do echo lib/$(basename $d); done | xargs redo-ifchange

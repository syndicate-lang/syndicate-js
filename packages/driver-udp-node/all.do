for d in src/*.js; do echo lib/$(basename $d); done | xargs redo-ifchange

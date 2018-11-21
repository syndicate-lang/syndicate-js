cd "$(dirname "$1")"
case "$1" in
    */all)
        for d in src/*.js; do [ -f "$d" ] && echo lib/$(basename "$d"); done | xargs redo-ifchange
        for d in *.webpack.config.js
        do
            [ -f "$d" ] && echo dist/$(basename "$d" .webpack.config.js).js
        done | xargs redo-ifchange
        [ -f _all.do ] && redo-ifchange _all || true
        ;;
    */clean)
        rm -rf lib
        rm -rf dist
        ;;
esac

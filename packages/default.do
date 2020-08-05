cd "$(dirname "$1")"
case "$1" in
    */all)
        for d in src/*.js; do [ -f "$d" ] && echo lib/$(basename "$d"); done | xargs redo-ifchange
        for d in *.dist.json
        do
            [ -f "$d" ] && echo dist/$(basename "$d" .dist.json).js
        done | xargs redo-ifchange
        [ -f _all.do ] && redo-ifchange _all || true
        ;;
    */clean)
        rm -rf lib
        rm -rf dist
        rm -rf .nyc_output
        rm -rf coverage
        ;;
    */veryclean)
        redo clean
        rm -rf node_modules
        rm -f package-lock.json
        ;;
esac

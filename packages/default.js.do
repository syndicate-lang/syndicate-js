# To be invoked with PACKAGENAME/lib/FOO.js or PACKAGENAME/dist/main.js
targettempfile="$(pwd)/$3"
mkdir -p "$(dirname "$1")"
cd "$(dirname "$1")"/..
case "$1" in
    syntax/lib/babel_parser.js)
        src=node_modules/@babel/parser/lib/index.js
        [ -f "$src" ] || npm -i .
        redo-ifchange "$src" babel_parser_suffix.js
        cat "$src" babel_parser_suffix.js
        ;;
    syntax/lib/*)
        file=$(basename "$1")
        redo-ifchange "src/$file"
        npx babel "src/$file"
        ;;
    */lib/*)
        redo-ifchange ../syntax/all
        file=$(basename "$1")
        redo-ifchange "src/$file"
        npx syndicate-babel "src/$file"
        ;;
    */dist/*)
        for d in src/*.js; do echo lib/$(basename $d); done | xargs redo-ifchange
        redo-ifchange webpack.config.js
        for maybedep in $(npx webpack --json -o "$targettempfile" | jq -r '.modules[].identifier')
        do
            [ -f "$maybedep" ] && echo "$maybedep"
        done | xargs redo-ifchange
        ;;
esac

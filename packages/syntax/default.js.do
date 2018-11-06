mkdir -p $(dirname "$1")
case "$1" in
    lib/babel_parser.js)
        src=node_modules/@babel/parser/lib/index.js
        [ -f "$src" ] || npm -i .
        redo-ifchange "$src" babel_parser_suffix.js
        cat "$src" babel_parser_suffix.js
        ;;
    *)
        src=$(echo "$1" | sed -e 's:^lib/:src/:')
        redo-ifchange "$src"
        npx babel "$src"
        ;;
esac

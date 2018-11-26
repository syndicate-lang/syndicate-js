# To be invoked with PACKAGENAME/lib/FOO.js or PACKAGENAME/dist/FOO.js
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
        # Conservatively assume the distribution depends on ALL the
        # local source files PLUS the lib/*.js of dependent syndicate
        # packages, other than core which has src/*.js files instead.
        #
        for d in src/*.js; do echo lib/$(basename $d); done | xargs redo-ifchange
        for dep in $(cat package.json | \
                         jq -r '.dependencies | to_entries[].key' | \
                         fgrep '@syndicate-lang/' | \
                         sed -e 's:^@syndicate-lang/::')
        do
            for srcfile in ../$dep/src/*.js
            do
                if [ -f $srcfile ]
                then
                    if [ "$dep" = "core" ]
                    then
                        echo $srcfile
                    else
                        libfile=$(echo $srcfile | sed -e 's:/src/:/lib/:')
                        echo $libfile
                    fi
                fi
            done
        done | xargs redo-ifchange
        configfile=$(basename "$1" .js).webpack.config.js
        redo-ifchange $configfile
        for maybedep in $(npx webpack --config "$configfile" --json -o "$targettempfile" | jq -r '.modules[].identifier')
        do
            [ -f "$maybedep" ] && echo "$maybedep"
        done | xargs redo-ifchange
        ;;
esac

cd "$(dirname "$1")"
case "$1" in
    */all)
        for d in src/*.js; do [ -f "$d" ] && echo lib/$(basename "$d"); done | xargs redo-ifchange
        for d in *.webpack.config.js
        do
            depifchange=''
            depifcreate=''
            for dep in $(cat package.json | \
                             jq -r '.dependencies | to_entries[].key' | \
                             fgrep '@syndicate-lang/' | \
                             sed -e 's:^@syndicate-lang/::' | \
                             fgrep -v 'core') ## core doesn't have any compilation step
            do
                for srcfile in ../$dep/src/*.js
                do
                    if [ -f $srcfile ]
                    then
                        libfile=$(echo $srcfile | sed -e 's:/src/:/lib/:')
                        if [ -f $libfile ]
                        then
                            depifchange="$depifchange $libfile"
                        else
                            depifcreate="$depifcreate $libfile"
                        fi
                    fi
                done
            done
            redo-ifchange $depifchange
            redo-ifchange $depifcreate
            [ -f "$d" ] && echo dist/$(basename "$d" .webpack.config.js).js
        done | xargs redo-ifchange
        [ -f _all.do ] && redo-ifchange _all || true
        ;;
    */clean)
        rm -rf lib
        rm -rf dist
        ;;
esac

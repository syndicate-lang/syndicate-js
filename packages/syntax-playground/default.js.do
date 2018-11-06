mkdir -p $(dirname "$1")
case "$1" in
    lib/*)
        src=$(echo "$1" | sed -e 's:^lib/:src/:')
        [ -f ../syntax/all.do ] && redo-ifchange ../syntax/all
        redo-ifchange "$src"
        mkdir -p $(dirname "$1")
        npx syndicate-babel "$src"
        ;;
    dist/*)
        for maybedep in $(npx webpack --json -o "$3" | jq -r '.modules[].identifier')
        do
            [ -f "$maybedep" ] && echo "$maybedep"
        done | xargs redo-ifchange
        ;;
esac

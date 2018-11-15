redo-ifchange $(find ../template)
target="$(pwd)/$3"
(cd ../template; zip -q -r "$target" .) >&2

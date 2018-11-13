redo-ifchange $(find ../template)
target="$(pwd)/$3"
(cd ../template; zip -r "$target" .) >&2

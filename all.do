(for p in packages/*/; do echo $p/all; done | xargs redo-ifchange) && (echo Done. >&2)

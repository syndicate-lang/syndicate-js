for p in packages/*/; do echo $p/veryclean; done | xargs redo
rm -rf node_modules

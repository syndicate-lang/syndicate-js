for p in packages/*; do [ -f $p/clean.do ] && echo $p/clean; done | xargs redo

for p in packages/*; do [ -f $p/all.do ] && echo $p/all; done | xargs redo-ifchange

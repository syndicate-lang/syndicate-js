src=$(echo "$1" | sed -e 's:^lib/:src/:')
[ -f ../syntax/all.do ] && redo-ifchange ../syntax/all
redo-ifchange "$src"
mkdir -p $(dirname "$1")
npx syndicate-babel "$src"

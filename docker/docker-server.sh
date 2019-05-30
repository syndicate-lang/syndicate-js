#!/bin/sh
dir="$(dirname "$0")/.."
case "$dir" in
    /*) ;;
    *) dir="$(pwd)/${dir}" ;;
esac

networkname=dockerint
if [ -z "$(docker network ls -qf name=${networkname})" ]
then
    docker network create --internal ${networkname}
fi

if [ -z "$1" ]
then
    nameopt=
else
    nameopt="--hostname $1"
    shift
fi

exec docker run -it --rm \
     --network ${networkname} \
     $nameopt \
     -v "${dir}":/data \
     "$@" \
     syndicate-js

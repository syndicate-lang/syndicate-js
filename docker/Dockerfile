FROM alpine:3.9

RUN apk update && apk upgrade
RUN apk add s6

# NB: From Alpine 3.9 onwards, the versions of nodejs and npm in the
# standard packageset are fine for Syndicate
# RUN apk add --no-cache nodejs npm --repository http://dl-cdn.alpinelinux.org/alpine/edge/main
RUN apk add --no-cache nodejs npm

RUN npm i -g preserves
ENV NODE_PATH=/usr/lib/node_modules

ADD built-packages /tmp/packages
RUN npm i --unsafe-perm -g /tmp/packages/*

# RUN apk add --no-cache daemontools --repository http://dl-cdn.alpinelinux.org/alpine/edge/testing

RUN apk add dbus avahi avahi-tools
RUN rm -f /etc/avahi/services/*

RUN mkdir -p /run/service
ADD service /run/service

WORKDIR /run/service
CMD ["s6-svscan", "-St1000", "/run/service"]

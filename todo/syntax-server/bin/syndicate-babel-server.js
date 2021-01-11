#!/bin/sh
//bin/true; exec node --experimental-worker "$0"
const Program = require("../lib/index");
const Syndicate = require("@syndicate-lang/core");
Syndicate.bootModule(Program);

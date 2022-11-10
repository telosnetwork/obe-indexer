#!/bin/bash

INSTALL_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [[ `pwd` != "$INSTALL_ROOT" ]]; then
  echo "Please run this script from $INSTALL_ROOT"
  exit 1
fi

yarn run build
SERVICE="$1"

pm2 start --only $SERVICE --update-env

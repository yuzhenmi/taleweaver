#!/bin/bash

cd packages/core && npm run build
cd ../extension-cursor && npm run build
cd ../extension-edit && npm run build

#!/bin/sh
npx prisma db push
node dist/src/index.js

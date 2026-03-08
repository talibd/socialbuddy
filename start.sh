#!/bin/sh
npx prisma db push
node dist/index.js

#!/usr/bin/env node
import { sync } from './build.mjs';
await sync();
console.log('copied lib/agentify.js and lib/validator-core.js into site/lib/');

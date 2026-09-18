#!/usr/bin/env node
'use strict';

/**
 * WATE Debug Adapter Entry for VS Code / Cursor / Windsurf / Antigravity IDE
 */
const path = require('path');
const fs = require('fs');

// Try resolving wate-debug.js locally or in parent workspace
let debugScript = path.join(__dirname, '..', 'wate-debug.js');
if (!fs.existsSync(debugScript)) {
  debugScript = path.join(__dirname, 'wate-debug.js');
}

const { WateDAPServer } = require(debugScript);
const server = new WateDAPServer();
server.start();

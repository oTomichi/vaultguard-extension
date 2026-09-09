const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'vaultguard-main.js');
const dest = path.join(__dirname, '..', 'build', 'chrome-mv3-prod', 'vaultguard-main.js');
fs.copyFileSync(src, dest);
console.log('Copied vaultguard-main.js to build output');

const path = require('node:path');
const process = require('process');

exports.location = () => `${path.basename(__dirname)}/${path.basename(__filename)} ${typeof process.cwd}`;

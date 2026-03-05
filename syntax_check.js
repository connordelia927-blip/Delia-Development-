const fs = require('fs');
let code = fs.readFileSync('game.js', 'utf8');

// Strip ES module syntax that Node can't parse via new Function
code = code.replace(/^\s*import\s+.*$/gm, '');
code = code.replace(/^\s*export\s+/gm, '');

try {
    new Function(code);
    console.log('game.js Syntax: OK');
} catch (e) {
    console.error('game.js Syntax ERROR:', e.message);
}

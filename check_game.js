const fs = require('fs');
let code = fs.readFileSync('game.js', 'utf8');
code = code.replace(/import.*?from.*?;/g, ''); // strip imports
try {
    new Function(code);
    console.log('game.js Syntax OK');
} catch (e) {
    console.error('game.js Syntax Error:', e.line, e.message);
}

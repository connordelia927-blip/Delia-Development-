const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>\s*([\s\S]*?)<\/script>/g);
if (scriptMatch) {
    const content = scriptMatch[scriptMatch.length - 1].replace(/<\/?script>/g, '');
    try {
        new Function(content);
        console.log('Syntax OK');
    } catch (e) {
        console.error('Syntax Error:', e.message);
    }
} else {
    console.log('No script found');
}

const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const stack = [];
const regex = /<\/?([a-zA-Z0-9]+)[^>]*>/g;
let match;

const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

while ((match = regex.exec(html)) !== null) {
    const isClosing = match[0].startsWith('</');
    const tag = match[1].toLowerCase();

    if (voidElements.has(tag)) continue;

    if (!isClosing) {
        stack.push({ tag, line: html.substring(0, match.index).split('\n').length });
    } else {
        const last = stack.pop();
        if (!last || last.tag !== tag) {
            console.log(`Mismatch! Closing </${tag}> on line ${html.substring(0, match.index).split('\n').length}, but last opened was ${last ? '<' + last.tag + '>' : 'nothing'}`);
            process.exit(1);
        }
    }
}

if (stack.length > 0) {
    console.log(`Unclosed tags remaining: ${stack.map(s => s.tag).join(', ')}`);
    process.exit(1);
}

console.log('HTML tags perfectly balanced!');

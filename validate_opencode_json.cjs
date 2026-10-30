const fs = require('fs');
const j = JSON.parse(fs.readFileSync('.opencode/opencode.json', 'utf8'));
console.log('JSON VALID');
console.log('Commands:', Object.keys(j.command || {}).join(', '));
console.log('Netlify enabled:', j.mcp?.netlify?.enabled);
console.log('Observability agent prompt present:', !!(j.agent?.observability?.prompt));

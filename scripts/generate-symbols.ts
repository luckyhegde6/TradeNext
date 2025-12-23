import fs from 'fs';
import path from 'path';

const csvPath = path.join(process.cwd(), 'sample', 'EQUITY_L.csv');
const outputPath = path.join(process.cwd(), 'lib', 'constants', 'symbols.json');

function generateSymbols() {
    try {
        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.split('\n');
        const symbols = [];

        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 2) continue;

            const symbol = parts[0].trim();
            const name = parts[1].trim().replace(/^"(.*)"$/, '$1'); // Remove quotes if present
            const series = parts[2]?.trim();

            // We mostly care about EQ and BE series for standard trading
            if (series === 'EQ' || series === 'BE' || series === 'BZ') {
                symbols.push({ symbol, name });
            }
        }

        // Sort symbols alphabetically
        symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));

        fs.writeFileSync(outputPath, JSON.stringify(symbols, null, 2));
        console.log(`Successfully generated ${symbols.length} symbols to ${outputPath}`);
    } catch (err) {
        console.error('Error generating symbols:', err);
    }
}

generateSymbols();

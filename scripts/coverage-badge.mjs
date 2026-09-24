// Writes a coverage badge (line coverage) as an SVG, from Jest's json-summary report.
// Usage: node scripts/coverage-badge.mjs <output.svg>
import { readFileSync, writeFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const pct = Math.floor(summary.total.lines.pct);
const color = pct >= 90 ? '#4c1' : pct >= 80 ? '#a3c51c' : pct >= 60 ? '#dfb317' : '#e05d44';
const value = `${pct}%`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="20" role="img" aria-label="coverage: ${value}">
  <rect width="61" height="20" fill="#555"/>
  <rect x="61" width="43" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="30.5" y="14">coverage</text>
    <text x="82.5" y="14">${value}</text>
  </g>
</svg>
`;

writeFileSync(process.argv[2], svg);

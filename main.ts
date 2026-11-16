// Driver for the markdown-render-speed entry.
// Reads every case from the input directory, renders each one on its own
// with parse() from parse.js, and writes the HTML strings in order to the
// output directory as a JSON array. The harness runs `node /bot/main.ts`;
// outside a container MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR stand in for
// /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(
  readFileSync(join(inDir, 'cases.json'), 'utf8'),
) as Array<{ id: string; markdown: string }>;

const out: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  out[i] = parse(cases[i].markdown);
}

writeFileSync(join(outDir, 'html.json'), JSON.stringify(out));

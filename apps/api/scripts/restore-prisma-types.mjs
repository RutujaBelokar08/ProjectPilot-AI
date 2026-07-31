import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const declarations = ['default.d.ts', 'index.d.ts'];

await Promise.all(declarations.map(declaration => copyFile(
  fileURLToPath(new URL(`../../../node_modules/.prisma/client/${declaration}`, import.meta.url)),
  fileURLToPath(new URL(`../../../node_modules/@prisma/client/${declaration}`, import.meta.url)),
)));

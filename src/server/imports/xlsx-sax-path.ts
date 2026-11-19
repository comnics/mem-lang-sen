import 'server-only';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';

export function resolveXlsxSaxPath(): string {
  // Resolve at runtime from the deployed app root, not import.meta.url: Turbopack
  // rewrites the latter's require.resolve('sax') into a numeric bundle module ID.
  // next start / standalone server.js must run from their application root.
  // next.config.ts explicitly traces sax for the preview route's eval worker.
  const runtimeRequire = createRequire(join(process.cwd(), 'package.json'));
  const path = runtimeRequire.resolve('sax');
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error('XLSX worker requires an absolute sax module filename.');
  }
  return path;
}

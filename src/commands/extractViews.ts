import path from 'node:path';
import fg from 'fast-glob';
import minimist from 'minimist';
import type { DatasetMetadata, ViewsDataset, ViewDisplayDefinition } from '../types.js';
import { writeJsonFile } from '../lib/fs.js';
import { DEFAULT_VIEWS_GLOB, PROJECT_ROOT, VIEWS_OUTPUT, resolveFromRoot } from '../lib/env.js';
import { parseViewFile } from '../lib/viewParser.js';

async function main() {
  const args = minimist(process.argv.slice(2), {
    string: ['glob', 'output'],
    alias: { g: 'glob', o: 'output' },
  });

  const globPattern = args.glob ?? DEFAULT_VIEWS_GLOB;
  const outputPath = args.output ? resolveFromRoot(args.output) : VIEWS_OUTPUT;

  const files = await fg(globPattern, {
    cwd: PROJECT_ROOT,
    absolute: true,
  });

  if (files.length === 0) {
    throw new Error(`No view configuration files matched glob "${globPattern}".`);
  }

  const views: ViewDisplayDefinition[] = [];
  for (const file of files) {
    const entries = await parseViewFile(file);
    views.push(...entries);
  }

  const dataset: DatasetMetadata<ViewsDataset> = {
    generatedAt: new Date().toISOString(),
    data: {
      views,
      filesParsed: files.length,
    },
  };

  await writeJsonFile(outputPath, dataset);
  console.log(
    `Extracted ${views.length} view displays across ${files.length} files -> ${path.relative(PROJECT_ROOT, outputPath)}`,
  );
}

main().catch((error) => {
  console.error('[extract-views] ERROR:', error);
  process.exitCode = 1;
});

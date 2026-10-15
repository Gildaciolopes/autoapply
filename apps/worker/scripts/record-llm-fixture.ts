/**
 * Records a real local-LLM extraction for a fixture PDF so tests can replay it offline.
 *   pnpm --filter @autoapply/worker exec tsx scripts/record-llm-fixture.ts <pdf|mcp-output.json> <out.json>
 * Writes the RAW LlmResumeExtraction (before code normalization) and prints timing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ollamaFromEnv } from '@autoapply/llm';
import { extractPdfText } from '@autoapply/resume';
import { EXTRACTION_SYSTEM_PROMPT, LlmResumeExtraction } from '../src/kb/draft-llm.js';
import { mcpToText } from '../src/kb/linkedin-importer.js';

const [pdfPath, outPath] = process.argv.slice(2);
if (!pdfPath || !outPath) throw new Error('usage: record-llm-fixture <pdf> <out.json>');
// .json input = saved MCP tool output (e.g. get_my_profile); otherwise a PDF.
const text = pdfPath.endsWith('.json')
  ? mcpToText(JSON.parse(readFileSync(pdfPath, 'utf8')))
  : (await extractPdfText(readFileSync(pdfPath))).text;
const t0 = Date.now();
const raw = await ollamaFromEnv().generateObject({
  schema: LlmResumeExtraction,
  numCtx: 16384,
  messages: [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: `TEXT:\n"""\n${text}\n"""` },
  ],
});
writeFileSync(outPath, JSON.stringify(raw, null, 2) + '\n');
console.log(`recorded in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outPath}`);

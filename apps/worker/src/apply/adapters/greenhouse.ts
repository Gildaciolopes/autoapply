import type { FieldType } from '@autoapply/shared';
import { frameWithMostFields, gotoForm, type Adapter, type FieldHint } from './types.js';

interface GhQuestion {
  label: string;
  required: boolean;
  fields: { name: string; type: string; values?: { label: string; value: number | string }[] }[];
}

const GH_TYPES: Record<string, FieldType> = {
  input_text: 'text',
  textarea: 'textarea',
  input_file: 'file',
  input_hidden: 'text',
  multi_value_single_select: 'select',
  multi_value_multi_select: 'checkbox',
};

/** Greenhouse: board page (or embed iframe) + public questions API (research R2). */
export const greenhouseAdapter: Adapter = {
  ats: 'greenhouse',
  async locate({ page, detected }) {
    if (!page.url().includes('greenhouse.io') && !page.frames().some((f) => f.url().includes('greenhouse.io'))) {
      await gotoForm(page, detected.formUrl);
    }
    const embed = page.frames().find((f) => /greenhouse\.io\/embed\/job_app/.test(f.url()));
    if (embed) return embed;
    return frameWithMostFields(page);
  },
  async hints({ detected, getJson }) {
    if (!detected.board || !detected.jobId) return [];
    const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${detected.board}/jobs/${detected.jobId}?questions=true`)) as { questions?: GhQuestion[] } | null;
    const out: FieldHint[] = [];
    for (const q of data?.questions ?? []) {
      for (const f of q.fields ?? []) {
        out.push({ name: f.name, label: q.label, required: q.required, type: GH_TYPES[f.type], options: f.values?.map((v) => v.label) ?? [] });
      }
    }
    return out;
  },
  async postingOpen({ detected, getJson }) {
    if (!detected.board || !detected.jobId) return null;
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${detected.board}/jobs/${detected.jobId}`);
    return data === null ? null : Boolean((data as { id?: unknown }).id);
  },
};

import type { AtsKind } from '@autoapply/shared';
import type { ExtractedField } from '../extract.js';
import { ashbyAdapter } from './ashby.js';
import { genericAdapter } from './generic.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import type { Adapter, FieldHint } from './types.js';

export * from './types.js';

const ADAPTERS: Record<AtsKind, Adapter> = { greenhouse: greenhouseAdapter, lever: leverAdapter, ashby: ashbyAdapter, generic: genericAdapter };

export const adapterFor = (ats: AtsKind): Adapter => ADAPTERS[ats];

const keyName = (f: ExtractedField) => f.name ?? f.key.match(/\[(?:id|name)="([^"]+)"\]/)?.[1];

/** API hints win for required flags and options; labels only replace empty/unhelpful ones. */
export function mergeHints(fields: ExtractedField[], hints: FieldHint[]): ExtractedField[] {
  if (!hints.length) return fields;
  const by = new Map(hints.map((h) => [h.name, h]));
  return fields.map((f) => {
    const n = keyName(f);
    const h = (n && (by.get(n) ?? by.get(n.replace(/^job_application\[|\]$/g, '')))) || undefined;
    if (!h) return f;
    // The API's question text is authoritative (the DOM label may be a button like "Anexar").
    return {
      ...f,
      label: h.label?.trim() || f.label,
      required: h.required ?? f.required,
      options: f.options.length ? f.options : (h.options ?? []),
    };
  });
}

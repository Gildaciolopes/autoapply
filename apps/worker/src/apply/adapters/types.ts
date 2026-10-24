import type { Frame, Page } from 'playwright';
import type { DetectedAts } from '@autoapply/apply';
import type { AtsKind, FieldType } from '@autoapply/shared';

/** Field metadata from a public ATS API, merged into DOM-extracted fields by name/id. */
export interface FieldHint {
  name: string;
  label?: string;
  required?: boolean;
  type?: FieldType;
  options?: string[];
}

export interface AdapterContext {
  page: Page;
  detected: DetectedAts;
  /** Public GET JSON (cached 24 h); null on any error. Never used for anything but reading. */
  getJson: (url: string) => Promise<unknown | null>;
}

export interface Adapter {
  ats: AtsKind;
  /** Opens the form and returns the frame that holds it. */
  locate(ctx: AdapterContext): Promise<Frame>;
  /** Public question metadata (labels, required flags, options). */
  hints(ctx: AdapterContext): Promise<FieldHint[]>;
  /** false = posting closed according to the public API; null = unknown. */
  postingOpen(ctx: AdapterContext): Promise<boolean | null>;
}

const FIELD_SELECTOR = 'input:not([type="hidden"]), textarea, select';

/** Frame with the most fillable fields (forms embedded in iframes, research R3). */
export async function frameWithMostFields(page: Page): Promise<Frame> {
  let best = page.mainFrame();
  let max = -1;
  for (const f of page.frames()) {
    const n = await f.locator(FIELD_SELECTOR).count().catch(() => 0);
    if (n > max) {
      max = n;
      best = f;
    }
  }
  return best;
}

export async function gotoForm(page: Page, url: string): Promise<number | null> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  return res?.status() ?? null;
}

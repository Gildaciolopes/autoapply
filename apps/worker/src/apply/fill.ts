import type { Frame } from 'playwright';
import type { ExtractedField } from './extract.js';

export interface AttachmentFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const TIMEOUT = 5000;

/**
 * Options belonging to THIS combobox (aria-controls/aria-owns listbox, else the widget's own container):
 * several comboboxes on a page may keep their menus in the DOM, so a page-wide [role=option] is wrong.
 */
const SCOPED_OPTIONS = `(el) => {
  const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
  const listbox = id ? document.getElementById(id) : null;
  let root = listbox;
  if (!root) {
    let a = el.parentElement;
    for (let i = 0; i < 6 && a && !root; i++, a = a.parentElement) if (a.querySelector('[role="option"]')) root = a;
  }
  return root ? [...root.querySelectorAll('[role="option"]')].map((o) => (o.innerText || o.textContent || '').trim()).filter(Boolean) : [];
}`;

async function scopedOptions(frame: Frame, key: string): Promise<string[]> {
  return frame.locator(key).first().evaluate(new Function(`return (${SCOPED_OPTIONS})`)() as (el: unknown) => string[]);
}

/** Clicks the option of this open combobox whose text equals `value` (never a page-wide match). */
async function pickComboOption(frame: Frame, key: string, value: string): Promise<boolean> {
  for (let t = 0; t < 10; t++) {
    const idx = (await scopedOptions(frame, key).catch(() => [] as string[])).indexOf(value);
    if (idx >= 0) {
      const ok = await frame.locator(key).first().evaluate(
        new Function(`return (el, i) => { const opts = (${SCOPED_OPTIONS})(el); const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns'); let root = id ? document.getElementById(id) : null; if (!root) { let a = el.parentElement; for (let k = 0; k < 6 && a && !root; k++, a = a.parentElement) if (a.querySelector('[role="option"]')) root = a; } const o = root && root.querySelectorAll('[role="option"]')[i]; if (!o || opts[i] === undefined) return false; o.scrollIntoView(); o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); o.click(); return true; }`)() as (el: unknown, i: number) => boolean,
        idx,
      );
      return ok;
    }
    await frame.waitForTimeout(200);
  }
  return false;
}

/**
 * Sets one field's value. Only touches the field itself — never a button (FR-001). Returns whether
 * the value was set; failures are reported, not thrown.
 */
export async function fillField(frame: Frame, field: ExtractedField, value: string | string[]): Promise<boolean> {
  const loc = frame.locator(field.key);
  const values = Array.isArray(value) ? value : [value];
  try {
    switch (field.type) {
      case 'radio': {
        const i = field.options.indexOf(values[0]!);
        if (i < 0) return false;
        if (field.buttons) {
          // Toggle-button widgets: a button inside a <form> defaults to type=submit, so make it a plain
          // button before clicking (the submit trap would stop it anyway, but it must not even try).
          return loc.first().locator(':scope > button[aria-pressed]').nth(i).evaluate((el) => {
            const b = el as HTMLButtonElement;
            if (b.form) b.type = 'button';
            b.click();
            return true;
          });
        }
        await loc.nth(i).check({ force: true, timeout: TIMEOUT });
        return true;
      }
      case 'checkbox': {
        if (!field.options.length) {
          if (values[0] === 'true') await loc.first().check({ force: true, timeout: TIMEOUT });
          else await loc.first().uncheck({ force: true, timeout: TIMEOUT });
          return true;
        }
        for (const v of values) {
          const i = field.options.indexOf(v);
          if (i < 0) return false;
          await loc.nth(i).check({ force: true, timeout: TIMEOUT });
        }
        return true;
      }
      case 'select': {
        if (field.combobox) {
          await loc.first().click({ timeout: TIMEOUT });
          const input = (await loc.first().evaluate((el) => el.tagName.toLowerCase())) === 'input' ? loc.first() : loc.first().locator('input').first();
          await input.fill(values[0]!, { timeout: TIMEOUT }).catch(() => undefined);
          if (await pickComboOption(frame, field.key, values[0]!)) return true;
          await input.fill('', { timeout: TIMEOUT }).catch(() => undefined); // typed filter may hide it
          return pickComboOption(frame, field.key, values[0]!);
        }
        await loc.first().selectOption(values.map((label) => ({ label })), { timeout: TIMEOUT });
        return true;
      }
      case 'file':
        return false; // attachments go through attachFile
      default:
        await loc.first().fill(values[0]!, { timeout: TIMEOUT });
        return true;
    }
  } catch {
    return false;
  }
}

/** Resume / letter from memory (FR-010): never written to disk. */
export async function attachFile(frame: Frame, field: ExtractedField, file: AttachmentFile): Promise<boolean> {
  try {
    await frame.locator(field.key).first().setInputFiles(file, { timeout: TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

const NEXT = /^(pr[oó]ximo|next|continuar|continue|avan[cç]ar|seguinte|pr[oó]xima etapa|next step)\b/i;
const SUBMIT = /(enviar|submit|apply|candidatar|finalizar|concluir|send|confirmar)/i;

/**
 * Multi-step forms (research R1.3): clicks a visible "Próximo/Next" control that is not a submit
 * label and waits for the DOM to change. Returns false when only the final submit remains.
 */
export async function nextStep(frame: Frame): Promise<boolean> {
  const buttons = frame.locator('button, [role="button"], input[type="button"], a[href="#"]');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const label = ((await b.innerText().catch(() => '')) || (await b.getAttribute('value')) || '').trim();
    if (!NEXT.test(label) || SUBMIT.test(label) || !(await b.isVisible().catch(() => false))) continue;
    // Visible text changes when the next step shows up (class toggles keep innerHTML length equal).
    const visibleText = "document.body ? document.body.innerText : ''";
    const before = await frame.evaluate(visibleText).catch(() => '');
    await b.click({ timeout: TIMEOUT }).catch(() => undefined);
    for (let t = 0; t < 20; t++) {
      await frame.waitForTimeout(500);
      const after = await frame.evaluate(visibleText).catch(() => '');
      if (after !== before) return true;
    }
    return false;
  }
  return false;
}

/** Options of a custom combobox are only rendered when opened: open, read (scoped), close. */
export async function readComboOptions(frame: Frame, field: ExtractedField): Promise<string[]> {
  try {
    await frame.locator(field.key).first().click({ timeout: TIMEOUT });
    let texts: string[] = [];
    for (let t = 0; t < 8 && !texts.length; t++) {
      await frame.waitForTimeout(200);
      texts = await scopedOptions(frame, field.key);
    }
    await frame.locator(field.key).first().press('Escape').catch(() => undefined);
    return [...new Set(texts)].slice(0, 300);
  } catch {
    return [];
  }
}

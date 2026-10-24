import type { Frame, Page } from 'playwright';
import { FormField } from '@autoapply/shared';
import type { PageSnapshot } from '@autoapply/apply';

/**
 * In-page extractor (research R3), evaluated as a string so the worker needs no DOM typings.
 * Returns one entry per field; radio/checkbox groups sharing a name become one field with options
 * in DOM order (the filler clicks the n-th input). Keys are attribute selectors, unique per frame.
 */
const EXTRACT = `((scope) => {
  const ROOT = (scope && document.querySelector(scope)) || document;
  const text = (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const visible = (el) => {
    if (el.closest('[hidden],[aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const attrSel = (el) => {
    if (el.id) return '[id="' + el.id.replace(/"/g, '\\\\"') + '"]';
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name.replace(/"/g, '\\\\"') + '"]';
    const path = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      const p = n.parentElement;
      const idx = p ? [...p.children].filter((c) => c.tagName === n.tagName).indexOf(n) + 1 : 1;
      path.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
      n = p;
    }
    return 'body > ' + path.join(' > ');
  };
  const byIds = (ids) => (ids || '').split(/\\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(' ');
  const labelOf = (el) => {
    if (el.labels && el.labels.length) {
      const t = text(el.labels[0]);
      if (t) return t;
    }
    const lb = byIds(el.getAttribute('aria-labelledby'));
    if (lb) return lb;
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();
    let a = el.parentElement;
    for (let i = 0; i < 4 && a; i++, a = a.parentElement) {
      const cand = a.querySelector('label, legend, [class*="label" i], [class*="question" i], [class*="title" i]');
      if (cand && !cand.contains(el) && text(cand)) return text(cand).slice(0, 300);
    }
    return (el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
  };
  const groupLabel = (inputs) => {
    const first = inputs[0];
    const fs = first.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && text(lg)) return text(lg);
    }
    const grp = first.closest('[role="radiogroup"], [role="group"]');
    if (grp) {
      const t = byIds(grp.getAttribute('aria-labelledby')) || grp.getAttribute('aria-label');
      if (t) return t;
    }
    // Option texts live inside the inputs' own <label>s: never take those as the question.
    const optionLabels = inputs.flatMap((x) => [...(x.labels || []), x.closest('label')]).filter(Boolean);
    const isOption = (c) => optionLabels.some((l) => l === c || l.contains(c) || c.contains(l)) || inputs.some((x) => c.contains(x));
    let a = first.parentElement;
    for (let i = 0; i < 6 && a; i++, a = a.parentElement) {
      if (!inputs.every((x) => a.contains(x))) continue;
      for (const sel of ['legend, [class*="label" i], [class*="question" i], [class*="title" i], label', 'p, span, div, h3, h4, strong']) {
        const cand = [...a.querySelectorAll(sel)].find((c) => !isOption(c) && text(c));
        if (cand) return text(cand).slice(0, 300);
      }
    }
    return first.name || '';
  };
  const required = (el, label) =>
    el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\\s*$/.test(label) || /\\(obrigat[oó]rio\\)|\\(required\\)/i.test(label);
  const optLabel = (el) => (el.labels && el.labels.length ? text(el.labels[0]) : el.getAttribute('aria-label') || el.value || '');

  const out = [];
  const groups = new Map();
  const els = ROOT.querySelectorAll('input, textarea, select, [role="combobox"]:not(input)');
  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    const t = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password'].includes(t)) continue;
    if (el.disabled || el.readOnly) continue;
    if (tag === 'input' && (t === 'radio' || t === 'checkbox')) {
      const name = el.name || attrSel(el);
      const k = t + '|' + name;
      if (!groups.has(k)) groups.set(k, { t, name, inputs: [] });
      groups.get(k).inputs.push(el);
      continue;
    }
    // Custom upload widgets hide the <input type=file>: keep it only when its label/container is visible.
    if (t === 'file' ? !(visible(el) || (el.labels && [...el.labels].some(visible)) || (el.parentElement && visible(el.parentElement))) : !visible(el)) continue;
    const label = labelOf(el);
    let type = tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : ['email', 'tel', 'number', 'url', 'date', 'file'].includes(t) ? t : 'text';
    let options = [];
    let multiple = false;
    if (tag === 'select') {
      options = [...el.options].filter((o) => o.value !== '' && !/^(select|selecione|escolha|choose|--)/i.test(o.textContent.trim())).map((o) => o.textContent.trim());
      multiple = el.multiple;
    }
    if (el.getAttribute('role') === 'combobox') type = 'select';
    out.push({
      key: attrSel(el),
      type,
      label,
      required: required(el, label),
      options,
      multiple,
      name: el.getAttribute('name') || undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      accept: el.getAttribute('accept') || undefined,
      maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      pattern: el.getAttribute('pattern') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      combobox: el.getAttribute('role') === 'combobox' || undefined,
    });
  }
  for (const g of groups.values()) {
    const shown = g.inputs.filter((x) => visible(x) || (x.labels && [...x.labels].some(visible)));
    if (!shown.length) continue;
    const single = g.t === 'checkbox' && shown.length === 1;
    const label = single ? optLabel(shown[0]) || groupLabel(shown) : groupLabel(shown);
    out.push({
      key: g.inputs[0].name ? 'input[type="' + g.t + '"][name="' + g.inputs[0].name.replace(/"/g, '\\\\"') + '"]' : attrSel(g.inputs[0]),
      type: g.t,
      label,
      required: shown.some((x) => required(x, label)),
      options: single ? [] : shown.map(optLabel),
      multiple: g.t === 'checkbox' && !single,
      name: g.inputs[0].name || undefined,
    });
  }
  // Yes/No (or small choice) widgets made of toggle buttons (Ashby "yesno"): one radio-like field.
  const seen = new Set();
  for (const b of ROOT.querySelectorAll('button[aria-pressed]')) {
    const box = b.parentElement;
    if (!box || seen.has(box)) continue;
    const buttons = [...box.querySelectorAll(':scope > button[aria-pressed]')];
    if (buttons.length < 2 || !buttons.some(visible)) continue;
    seen.add(box);
    let label = '';
    let reqd = false;
    let a = box.parentElement;
    for (let i = 0; i < 4 && a && !label; i++, a = a.parentElement) {
      const cand = a.querySelector('label, legend, [class*="question" i], [class*="title" i]');
      if (cand && !box.contains(cand) && text(cand)) {
        label = text(cand).slice(0, 300);
        reqd = /required/i.test(cand.className || '') || /[*✱]\s*$/.test(label);
      }
    }
    out.push({ key: attrSel(box), type: 'radio', label, required: reqd, options: buttons.map(text), multiple: false, buttons: true });
  }
  return out;
})(__SCOPE__)`;

export type ExtractedField = FormField & { combobox?: boolean; buttons?: boolean };

/** `scope`: CSS selector of the form root (e.g. LinkedIn's Easy Apply modal); whole document otherwise. */
export async function extractFields(frame: Frame, step: number, scope?: string): Promise<ExtractedField[]> {
  const raw = (await frame.evaluate(EXTRACT.replace('__SCOPE__', JSON.stringify(scope ?? null)))) as Record<string, unknown>[];
  return raw.map((r) => ({ ...FormField.parse({ ...r, step, frameUrl: frame.url() }), combobox: Boolean(r.combobox) || undefined, buttons: Boolean(r.buttons) || undefined }));
}

const SNAPSHOT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width >= 20 && r.height >= 20 && getComputedStyle(el).visibility !== 'hidden'; };
  return {
    title: document.title || '',
    text: (document.body ? document.body.innerText : '').slice(0, 6000),
    visibleIframes: [...document.querySelectorAll('iframe')].filter(vis).map((f) => f.src || ''),
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src),
    hasPasswordField: !!document.querySelector('input[type="password"]'),
    captchaWidgets: [...document.querySelectorAll('.g-recaptcha:not([data-size="invisible"]), .h-captcha:not([data-size="invisible"]), .cf-turnstile, [data-sitekey]:not([data-size="invisible"])')].filter(vis).length,
  };
})()`;

/** Blocker snapshot over all frames (research R7). */
export async function snapshotForBlockers(page: Page, fieldCount: number): Promise<PageSnapshot> {
  const parts = await Promise.all(page.frames().map((f) => f.evaluate(SNAPSHOT).catch(() => null)));
  const ok = parts.filter(Boolean) as Omit<PageSnapshot, 'fieldCount'>[];
  return {
    title: ok[0]?.title ?? '',
    text: ok.map((p) => p.text).join('\n').slice(0, 8000),
    visibleIframes: ok.flatMap((p) => p.visibleIframes),
    scripts: ok.flatMap((p) => p.scripts),
    hasPasswordField: ok.some((p) => p.hasPasswordField),
    captchaWidgets: ok.reduce((n, p) => n + p.captchaWidgets, 0),
    fieldCount,
  };
}

import { describe, expect, it } from 'vitest';
import { dedupeHash, originKey } from '../src/dedupe.js';
import { parseLocation } from '../src/normalize.js';

describe('dedupeHash', () => {
  it('same job on two boards → same hash', () => {
    const a = dedupeHash('Víssimo', 'Desenvolvedor(a) Full Stack (com ênfase em Frontend)', parseLocation('Remoto'));
    const b = dedupeHash('Vissimo Ltda.', 'Desenvolvedor Full Stack', parseLocation('100% remoto'));
    expect(a).toBe(b);
  });
  it('different UF → different hash', () => {
    expect(dedupeHash('Acme', 'Dev Node', parseLocation('São Paulo, SP'))).not.toBe(dedupeHash('Acme', 'Dev Node', parseLocation('Recife, PE')));
  });
  it('origin key falls back to url', () => {
    expect(originKey({ url: 'https://x/1' })).toBe('https://x/1');
    expect(originKey({ externalId: '42', url: 'https://x/1' })).toBe('42');
  });
});

import { describe, expect, it } from 'vitest';
import { profileHash, profileText, suggestPreferences } from '../src/profile.js';
import { anaFacts, prefs } from './fixtures.js';

describe('profile', () => {
  it('suggests roles (most recent first), stack by evidence, city + remote', () => {
    const s = suggestPreferences(anaFacts, { city: 'São Paulo, SP' }, { workModes: ['remote'] });
    expect(s.roles).toEqual(['Engenheira de Software Sênior', 'Desenvolvedora Pleno']);
    expect(s.stack.slice(0, 2)).toEqual(['TypeScript', 'React']);
    expect(s.locations).toEqual(['São Paulo/SP', 'remote']);
    expect(s.workModes).toEqual(['remote']);
    expect(s.minSalary).toBeNull();
    expect(s.saved).toBe(false);
  });
  it('profile text is deterministic and only uses given facts', () => {
    const a = profileText(anaFacts, prefs());
    expect(profileText([...anaFacts].reverse(), prefs())).toBe(a);
    expect(a).toContain('experience: Engenheira de Software Sênior at Xeno Tecnologia');
    expect(profileHash(a)).toHaveLength(64);
  });
});

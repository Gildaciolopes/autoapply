import type { Ecosystem } from '@autoapply/shared';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
}

export const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
] as const;
export type ManifestFile = (typeof MANIFEST_FILES)[number];

const uniq = (deps: Dependency[]) => [...new Map(deps.map((d) => [`${d.ecosystem}:${d.name.toLowerCase()}`, d])).values()];

/** Section body of a TOML table, e.g. [tool.poetry.dependencies]. */
function tomlSection(text: string, header: string): string {
  const re = new RegExp(`^\\[${header.replace(/\./g, '\\.')}\\]\\s*$([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm');
  return re.exec(text)?.[1] ?? '';
}
const tomlKeys = (body: string) =>
  [...body.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]!).filter((k) => k !== 'python');
const pep508Name = (spec: string) => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1];

/**
 * Deterministic dependency extraction (no LLM). Unknown/invalid content yields []. Only declared
 * dependency names are returned; mapping to skills happens via the curated dictionary.
 */
export function parseManifest(file: ManifestFile, text: string): Dependency[] {
  try {
    switch (file) {
      case 'package.json': {
        const j = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
        const names = [j.dependencies, j.devDependencies, j.peerDependencies].flatMap((o) => Object.keys(o ?? {}));
        return uniq(names.map((name) => ({ ecosystem: 'npm', name })));
      }
      case 'composer.json': {
        const j = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
        return uniq([j.require, j['require-dev']].flatMap((o) => Object.keys(o ?? {})).filter((n) => n.includes('/')).map((name) => ({ ecosystem: 'composer', name })));
      }
      case 'requirements.txt':
        return uniq(
          text
            .split('\n')
            .map((l) => l.replace(/#.*/, '').trim())
            .filter((l) => l && !l.startsWith('-'))
            .map(pep508Name)
            .filter((n): n is string => Boolean(n))
            .map((name) => ({ ecosystem: 'pypi', name })),
        );
      case 'pyproject.toml': {
        const pep621 = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]\s*$/m.exec(tomlSection(text, 'project'))?.[1] ?? '';
        const fromPep621 = [...pep621.matchAll(/["']([^"']+)["']/g)].map((m) => pep508Name(m[1]!));
        const optional = [...tomlSection(text, 'project.optional-dependencies').matchAll(/["']([^"']+)["']/g)].map((m) => pep508Name(m[1]!));
        const poetry = [
          ...tomlKeys(tomlSection(text, 'tool.poetry.dependencies')),
          ...tomlKeys(tomlSection(text, 'tool.poetry.group.dev.dependencies')),
        ];
        const groups = [...tomlSection(text, 'dependency-groups').matchAll(/["']([^"']+)["']/g)].map((m) => pep508Name(m[1]!));
        return uniq(
          [...fromPep621, ...optional, ...poetry, ...groups].filter((n): n is string => Boolean(n)).map((name) => ({ ecosystem: 'pypi', name })),
        );
      }
      case 'go.mod': {
        const block = /require\s*\(([\s\S]*?)\)/.exec(text)?.[1] ?? '';
        const single = [...text.matchAll(/^require\s+(\S+)\s+v/gm)].map((m) => m[1]!);
        const multi = block.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n): n is string => Boolean(n) && !n!.startsWith('//'));
        return uniq([...single, ...multi].map((name) => ({ ecosystem: 'go', name })));
      }
      case 'Cargo.toml':
        return uniq(
          [...tomlKeys(tomlSection(text, 'dependencies')), ...tomlKeys(tomlSection(text, 'dev-dependencies'))].map((name) => ({ ecosystem: 'cargo', name })),
        );
      case 'pom.xml':
        return uniq(
          [...text.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map((m) => ({
            ecosystem: 'maven',
            name: `${m[1]!.trim()}:${m[2]!.trim()}`,
          })),
        );
      case 'build.gradle':
        return uniq(
          [...text.matchAll(/(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*['"]([^:'"]+):([^:'"]+)/g)].map((m) => ({
            ecosystem: 'maven',
            name: `${m[1]}:${m[2]}`,
          })),
        );
      case 'Gemfile':
        return uniq([...text.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)].map((m) => ({ ecosystem: 'gem', name: m[1]! })));
    }
  } catch {
    return [];
  }
}

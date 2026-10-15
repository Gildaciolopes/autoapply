import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifests.js';

describe('parseManifest', () => {
  it('package.json deps + devDeps', () => {
    const d = parseManifest('package.json', JSON.stringify({ dependencies: { react: '1' }, devDependencies: { vitest: '1' } }));
    expect(d.map((x) => x.name)).toEqual(['react', 'vitest']);
  });
  it('pyproject PEP 621 + poetry', () => {
    expect(parseManifest('pyproject.toml', '[project]\ndependencies = ["fastapi>=0.1", "pandas[sql]"]\n').map((x) => x.name)).toEqual(['fastapi', 'pandas']);
    expect(parseManifest('pyproject.toml', '[tool.poetry.dependencies]\npython = "^3.12"\ndjango = "^5"\n').map((x) => x.name)).toEqual(['django']);
  });
  it('requirements, go.mod, Cargo, pom, gradle, composer, Gemfile', () => {
    expect(parseManifest('requirements.txt', '# c\nflask==3\n-r other.txt\nrequests>=2\n').map((x) => x.name)).toEqual(['flask', 'requests']);
    expect(parseManifest('go.mod', 'module x\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n').map((x) => x.name)).toEqual(['github.com/gin-gonic/gin']);
    expect(parseManifest('Cargo.toml', '[dependencies]\nserde = "1"\ntokio = { version = "1" }\n').map((x) => x.name)).toEqual(['serde', 'tokio']);
    expect(parseManifest('pom.xml', '<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>')[0]!.name).toBe(
      'org.springframework.boot:spring-boot-starter-web',
    );
    expect(parseManifest('build.gradle', "implementation 'org.springframework.boot:spring-boot-starter:3'")[0]!.name).toBe('org.springframework.boot:spring-boot-starter');
    expect(parseManifest('composer.json', JSON.stringify({ require: { php: '>=8', 'laravel/framework': '^11' } })).map((x) => x.name)).toEqual(['laravel/framework']);
    expect(parseManifest('Gemfile', "gem 'rails'\n  gem \"pg\"\n").map((x) => x.name)).toEqual(['rails', 'pg']);
  });
  it('invalid content → []', () => {
    expect(parseManifest('package.json', '{nope')).toEqual([]);
  });
});

/**
 * Curated skills dictionary: canonical id, label, synonyms, package aliases and GitHub language names.
 * Used to key skill facts (F1), derive GitHub evidence deterministically (no LLM) and, in F3, as the
 * synonym table of the Zero-Fabrication validator. Add entries here, never infer skills elsewhere.
 */
export type Ecosystem = 'npm' | 'pypi' | 'go' | 'cargo' | 'maven' | 'composer' | 'gem';

export interface SkillDef {
  id: string;
  label: string;
  category: 'language' | 'frontend' | 'backend' | 'data' | 'devops' | 'cloud' | 'ai' | 'testing' | 'mobile' | 'tool';
  synonyms: string[];
  packages: Partial<Record<Ecosystem, string[]>>;
  githubLanguages: string[];
}

const s = (
  id: string,
  label: string,
  category: SkillDef['category'],
  opts: { syn?: string[]; pkg?: SkillDef['packages']; gh?: string[] } = {},
): SkillDef => ({ id, label, category, synonyms: opts.syn ?? [], packages: opts.pkg ?? {}, githubLanguages: opts.gh ?? [] });

export const SKILLS: SkillDef[] = [
  // languages
  s('typescript', 'TypeScript', 'language', { syn: ['ts'], pkg: { npm: ['typescript'] }, gh: ['TypeScript'] }),
  s('javascript', 'JavaScript', 'language', { syn: ['js', 'ecmascript', 'es6'], gh: ['JavaScript'] }),
  s('python', 'Python', 'language', { syn: ['python3', 'py'], gh: ['Python'] }),
  s('java', 'Java', 'language', { gh: ['Java'] }),
  s('kotlin', 'Kotlin', 'language', { gh: ['Kotlin'] }),
  s('go', 'Go', 'language', { syn: ['golang'], gh: ['Go'] }),
  s('rust', 'Rust', 'language', { gh: ['Rust'] }),
  s('csharp', 'C#', 'language', { syn: ['c sharp', 'c#'], gh: ['C#'] }),
  s('cpp', 'C++', 'language', { syn: ['c++', 'cplusplus'], gh: ['C++'] }),
  s('c', 'C', 'language', { gh: ['C'] }),
  s('php', 'PHP', 'language', { gh: ['PHP'] }),
  s('ruby', 'Ruby', 'language', { gh: ['Ruby'] }),
  s('swift', 'Swift', 'language', { gh: ['Swift'] }),
  s('dart', 'Dart', 'language', { gh: ['Dart'] }),
  s('elixir', 'Elixir', 'language', { gh: ['Elixir'] }),
  s('scala', 'Scala', 'language', { gh: ['Scala'] }),
  s('sql', 'SQL', 'language', { syn: ['plpgsql', 'pl/pgsql'], gh: ['PLpgSQL', 'TSQL', 'PLSQL'] }),
  s('bash', 'Shell/Bash', 'language', { syn: ['shell', 'shell script', 'sh', 'zsh'], gh: ['Shell'] }),
  s('html', 'HTML', 'frontend', { syn: ['html5'], gh: ['HTML'] }),
  s('css', 'CSS', 'frontend', { syn: ['css3', 'scss', 'sass'], pkg: { npm: ['sass'] }, gh: ['CSS', 'SCSS'] }),
  // frontend
  s('react', 'React', 'frontend', { syn: ['react.js', 'reactjs'], pkg: { npm: ['react', 'react-dom'] } }),
  s('nextjs', 'Next.js', 'frontend', { syn: ['next', 'next.js', 'nextjs'], pkg: { npm: ['next'] } }),
  s('vue', 'Vue.js', 'frontend', { syn: ['vue', 'vuejs', 'vue.js'], pkg: { npm: ['vue'] }, gh: ['Vue'] }),
  s('nuxt', 'Nuxt', 'frontend', { syn: ['nuxt.js', 'nuxtjs'], pkg: { npm: ['nuxt'] } }),
  s('angular', 'Angular', 'frontend', { syn: ['angularjs'], pkg: { npm: ['@angular/core'] } }),
  s('svelte', 'Svelte', 'frontend', { syn: ['sveltekit'], pkg: { npm: ['svelte', '@sveltejs/kit'] }, gh: ['Svelte'] }),
  s('tailwindcss', 'Tailwind CSS', 'frontend', { syn: ['tailwind'], pkg: { npm: ['tailwindcss'] } }),
  s('redux', 'Redux', 'frontend', { pkg: { npm: ['redux', '@reduxjs/toolkit'] } }),
  s('react-query', 'TanStack Query', 'frontend', { syn: ['react query', 'tanstack query'], pkg: { npm: ['@tanstack/react-query', 'react-query'] } }),
  s('vite', 'Vite', 'tool', { pkg: { npm: ['vite'] } }),
  s('shadcn', 'shadcn/ui', 'frontend', { syn: ['shadcn/ui', 'shadcn ui'] }),
  s('react-native', 'React Native', 'mobile', { syn: ['react-native'], pkg: { npm: ['react-native', 'expo'] } }),
  s('flutter', 'Flutter', 'mobile', {}),
  // backend
  s('nodejs', 'Node.js', 'backend', { syn: ['node', 'node.js', 'nodejs'], pkg: { npm: ['@types/node'] } }),
  s('nestjs', 'NestJS', 'backend', { syn: ['nest', 'nest.js'], pkg: { npm: ['@nestjs/core'] } }),
  s('express', 'Express', 'backend', { syn: ['express.js', 'expressjs'], pkg: { npm: ['express'] } }),
  s('fastify', 'Fastify', 'backend', { pkg: { npm: ['fastify'] } }),
  s('graphql', 'GraphQL', 'backend', { pkg: { npm: ['graphql', '@apollo/server', 'apollo-server'], pypi: ['graphene', 'strawberry-graphql'] } }),
  s('trpc', 'tRPC', 'backend', { pkg: { npm: ['@trpc/server'] } }),
  s('django', 'Django', 'backend', { pkg: { pypi: ['django', 'djangorestframework'] } }),
  s('fastapi', 'FastAPI', 'backend', { pkg: { pypi: ['fastapi'] } }),
  s('flask', 'Flask', 'backend', { pkg: { pypi: ['flask'] } }),
  s('celery', 'Celery', 'backend', { pkg: { pypi: ['celery'] } }),
  s('spring', 'Spring Boot', 'backend', { syn: ['spring boot', 'springboot', 'spring framework'], pkg: { maven: ['org.springframework.boot', 'spring-boot-starter-web'] } }),
  s('laravel', 'Laravel', 'backend', { pkg: { composer: ['laravel/framework'] } }),
  s('rails', 'Ruby on Rails', 'backend', { syn: ['ruby on rails', 'ror'], pkg: { gem: ['rails'] } }),
  s('dotnet', '.NET', 'backend', { syn: ['.net', 'asp.net', 'dotnet core', '.net core'] }),
  s('gin', 'Gin', 'backend', { pkg: { go: ['github.com/gin-gonic/gin'] } }),
  s('prisma', 'Prisma', 'data', { pkg: { npm: ['prisma', '@prisma/client'] } }),
  s('typeorm', 'TypeORM', 'data', { pkg: { npm: ['typeorm'] } }),
  s('sqlalchemy', 'SQLAlchemy', 'data', { pkg: { pypi: ['sqlalchemy'] } }),
  s('bullmq', 'BullMQ', 'backend', { syn: ['bull'], pkg: { npm: ['bullmq', 'bull'] } }),
  s('zod', 'Zod', 'backend', { pkg: { npm: ['zod'] } }),
  s('websocket', 'WebSockets', 'backend', { syn: ['websockets', 'socket.io'], pkg: { npm: ['socket.io', 'ws'] } }),
  s('rest', 'REST APIs', 'backend', { syn: ['rest api', 'restful', 'api rest'] }),
  s('microservices', 'Microservices', 'backend', { syn: ['microsserviços', 'microsservicos'] }),
  // data
  s('postgresql', 'PostgreSQL', 'data', { syn: ['postgres', 'psql'], pkg: { npm: ['pg'], pypi: ['psycopg2', 'psycopg', 'psycopg2-binary', 'asyncpg'] } }),
  s('mysql', 'MySQL', 'data', { pkg: { npm: ['mysql2', 'mysql'], pypi: ['mysqlclient', 'pymysql'] } }),
  s('mongodb', 'MongoDB', 'data', { syn: ['mongo'], pkg: { npm: ['mongodb', 'mongoose'], pypi: ['pymongo'] } }),
  s('redis', 'Redis', 'data', { pkg: { npm: ['redis', 'ioredis'], pypi: ['redis'] } }),
  s('sqlite', 'SQLite', 'data', { pkg: { npm: ['better-sqlite3', 'sqlite3'] } }),
  s('elasticsearch', 'Elasticsearch', 'data', { syn: ['elastic', 'opensearch'], pkg: { npm: ['@elastic/elasticsearch'], pypi: ['elasticsearch'] } }),
  s('pgvector', 'pgvector', 'data', { pkg: { npm: ['pgvector'], pypi: ['pgvector'] } }),
  s('kafka', 'Kafka', 'data', { syn: ['apache kafka'], pkg: { npm: ['kafkajs'], pypi: ['kafka-python', 'confluent-kafka'] } }),
  s('rabbitmq', 'RabbitMQ', 'data', { pkg: { npm: ['amqplib'], pypi: ['pika'] } }),
  s('pandas', 'pandas', 'data', { pkg: { pypi: ['pandas'] } }),
  s('numpy', 'NumPy', 'data', { pkg: { pypi: ['numpy'] } }),
  s('spark', 'Apache Spark', 'data', { syn: ['pyspark', 'spark'], pkg: { pypi: ['pyspark'] } }),
  s('airflow', 'Apache Airflow', 'data', { syn: ['airflow'], pkg: { pypi: ['apache-airflow'] } }),
  // ai
  s('llm', 'LLMs', 'ai', { syn: ['large language models', 'llms', 'genai', 'generative ai', 'ia generativa'] }),
  s('openai-api', 'OpenAI API', 'ai', { syn: ['openai'], pkg: { npm: ['openai'], pypi: ['openai'] } }),
  s('anthropic-api', 'Anthropic API', 'ai', { syn: ['anthropic', 'claude api'], pkg: { npm: ['@anthropic-ai/sdk'], pypi: ['anthropic'] } }),
  s('langchain', 'LangChain', 'ai', { pkg: { npm: ['langchain', '@langchain/core'], pypi: ['langchain', 'langchain-core'] } }),
  s('llamaindex', 'LlamaIndex', 'ai', { pkg: { pypi: ['llama-index'], npm: ['llamaindex'] } }),
  s('ollama', 'Ollama', 'ai', { pkg: { npm: ['ollama'], pypi: ['ollama'] } }),
  s('rag', 'RAG', 'ai', { syn: ['retrieval augmented generation', 'retrieval-augmented generation'] }),
  s('mcp', 'Model Context Protocol', 'ai', { syn: ['model context protocol'], pkg: { npm: ['@modelcontextprotocol/sdk'], pypi: ['mcp'] } }),
  s('vercel-ai-sdk', 'Vercel AI SDK', 'ai', { syn: ['ai sdk'], pkg: { npm: ['ai'] } }),
  s('pytorch', 'PyTorch', 'ai', { syn: ['torch'], pkg: { pypi: ['torch'] } }),
  s('tensorflow', 'TensorFlow', 'ai', { pkg: { pypi: ['tensorflow'] } }),
  s('scikit-learn', 'scikit-learn', 'ai', { syn: ['sklearn'], pkg: { pypi: ['scikit-learn'] } }),
  s('huggingface', 'Hugging Face', 'ai', { syn: ['hugging face', 'transformers'], pkg: { pypi: ['transformers'] } }),
  s('jupyter', 'Jupyter', 'tool', { gh: ['Jupyter Notebook'] }),
  // testing
  s('jest', 'Jest', 'testing', { pkg: { npm: ['jest'] } }),
  s('vitest', 'Vitest', 'testing', { pkg: { npm: ['vitest'] } }),
  s('playwright', 'Playwright', 'testing', { pkg: { npm: ['playwright', '@playwright/test'], pypi: ['playwright'] } }),
  s('cypress', 'Cypress', 'testing', { pkg: { npm: ['cypress'] } }),
  s('pytest', 'pytest', 'testing', { pkg: { pypi: ['pytest'] } }),
  s('testing-library', 'Testing Library', 'testing', { syn: ['react testing library'], pkg: { npm: ['@testing-library/react'] } }),
  // devops / cloud
  s('docker', 'Docker', 'devops', { syn: ['docker compose', 'docker-compose'], gh: ['Dockerfile'] }),
  s('kubernetes', 'Kubernetes', 'devops', { syn: ['k8s'] }),
  s('terraform', 'Terraform', 'devops', { gh: ['HCL'] }),
  s('github-actions', 'GitHub Actions', 'devops', { syn: ['github actions', 'gh actions'] }),
  s('ci-cd', 'CI/CD', 'devops', { syn: ['ci/cd', 'continuous integration', 'integração contínua'] }),
  s('nginx', 'Nginx', 'devops', {}),
  s('linux', 'Linux', 'devops', {}),
  s('git', 'Git', 'tool', {}),
  s('aws', 'AWS', 'cloud', { syn: ['amazon web services'], pkg: { npm: ['aws-sdk'], pypi: ['boto3'] } }),
  s('gcp', 'Google Cloud', 'cloud', { syn: ['google cloud', 'google cloud platform'] }),
  s('azure', 'Azure', 'cloud', { syn: ['microsoft azure'] }),
  s('vercel', 'Vercel', 'cloud', {}),
  s('supabase', 'Supabase', 'cloud', { pkg: { npm: ['@supabase/supabase-js'], pypi: ['supabase'] } }),
  s('firebase', 'Firebase', 'cloud', { pkg: { npm: ['firebase', 'firebase-admin'] } }),
  s('s3', 'Amazon S3', 'cloud', { syn: ['minio', 's3'], pkg: { npm: ['@aws-sdk/client-s3'] } }),
  s('stripe', 'Stripe', 'tool', { pkg: { npm: ['stripe'], pypi: ['stripe'] } }),
];

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const aliasIndex = new Map<string, SkillDef>();
const packageIndex = new Map<string, SkillDef>();
const languageIndex = new Map<string, SkillDef>();
for (const def of SKILLS) {
  for (const a of [def.id, def.label, ...def.synonyms]) aliasIndex.set(norm(a), def);
  for (const [eco, names] of Object.entries(def.packages)) for (const n of names ?? []) packageIndex.set(`${eco}:${n.toLowerCase()}`, def);
  for (const l of def.githubLanguages) languageIndex.set(norm(l), def);
}

/** Exact alias lookup (case/accent-insensitive). "Postgres" → postgresql. */
export function findSkillByAlias(text: string): SkillDef | undefined {
  return aliasIndex.get(norm(text));
}

/** Dependency name → skill. Maven matches by groupId or artifactId. */
export function skillByPackage(ecosystem: Ecosystem, name: string): SkillDef | undefined {
  const n = name.toLowerCase();
  if (ecosystem === 'maven') {
    for (const part of n.split(':')) {
      const hit = packageIndex.get(`maven:${part}`);
      if (hit) return hit;
    }
    return undefined;
  }
  return packageIndex.get(`${ecosystem}:${n}`);
}

export function skillByGithubLanguage(language: string): SkillDef | undefined {
  return languageIndex.get(norm(language));
}

/**
 * Finds dictionary skills mentioned in free text (README). Matches whole words/phrases only.
 * Single-letter or ambiguous aliases ("c", "go", "next", "rest", "ai", "s3", "bull", "spark") are
 * excluded from free-text matching to avoid false evidence.
 */
const TEXT_ALIAS_BLOCKLIST = new Set(['c', 'go', 'next', 'rest', 'ai', 's3', 'bull', 'spark', 'node', 'js', 'ts', 'py', 'sh', 'git', 'linux', 'mcp', 'elastic', 'transformers', 'torch', 'vue', 'mongo', 'airflow', 'tailwind', 'nest', 'openai', 'anthropic', 'shell', 'ror', 'minio']);
const textAliases = [...aliasIndex.entries()]
  .filter(([alias]) => alias.length > 1 && !TEXT_ALIAS_BLOCKLIST.has(alias))
  .sort((a, b) => b[0].length - a[0].length);
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findSkillsInText(text: string): SkillDef[] {
  const hay = ` ${norm(text).replace(/\s+/g, ' ')} `;
  const found = new Map<string, SkillDef>();
  for (const [alias, def] of textAliases) {
    if (found.has(def.id)) continue;
    const re = new RegExp(`(?<![a-z0-9@/_-])${escapeRe(alias)}(?![a-z0-9_-]|\\.[a-z])`);
    if (re.test(hay)) found.set(def.id, def);
  }
  return [...found.values()];
}

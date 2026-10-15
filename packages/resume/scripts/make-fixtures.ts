/**
 * Regenerates synthetic resume PDFs used by worker/api tests (no real PII):
 *   persona-ana.pdf  — text PDF in a "foreign" layout (not our renderer), pt-BR, mixed date formats
 *   persona-scan.pdf — same page as a raster image only (no text layer) → image_only path
 *   persona-{bruno,carla,diego,elisa}.pdf — extraction-quality eval set (SC-002)
 * Run: pnpm --filter @autoapply/resume exec tsx scripts/make-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
body{font-family:Georgia,serif;font-size:11pt;margin:28px 36px;color:#222}
h1{font-size:22pt;margin:0} .c{color:#555;margin:4px 0 14px} h2{font-size:12pt;border-bottom:1px solid #999;margin:16px 0 6px}
.j{display:flex;justify-content:space-between;font-weight:bold} ul{margin:4px 0 8px 18px;padding:0}
</style></head><body>
<h1>Ana Beatriz Souza</h1>
<div class="c">Engenheira de Software Full-Stack · São Paulo, SP · ana.souza@example.com · +55 11 90000-0000 · linkedin.com/in/ana-souza-example</div>
<h2>Resumo</h2><p>Engenheira full-stack com foco em TypeScript, Node.js e produtos B2B.</p>
<h2>Experiência Profissional</h2>
<div class="j"><span>Xeno Tecnologia Ltda — Engenheira de Software Sênior</span><span>mar 2021 – atual</span></div>
<ul><li>Migrei a API de pagamentos de Express para NestJS, reduzindo a latência p95 em 40%.</li>
<li>Implantei filas com BullMQ e Redis para processar 2 milhões de eventos por dia.</li></ul>
<div class="j"><span>Loja Fácil — Desenvolvedora Pleno</span><span>06/2018 - 02/2021</span></div>
<ul><li>Desenvolvi o checkout em React e Next.js usado por 300 lojas.</li><li>Modelei o banco PostgreSQL de pedidos e estoque.</li></ul>
<h2>Formação</h2><div class="j"><span>Universidade de São Paulo — Bacharelado em Ciência da Computação</span><span>2014 – 2018</span></div>
<h2>Habilidades</h2><p>TypeScript, Python, NestJS, Postgres, React, Docker</p>
<h2>Idiomas</h2><p>Português (nativo), Inglês (avançado)</p>
<h2>Certificações</h2><p>AWS Certified Developer – Associate (Amazon Web Services)</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.setContent(html);
writeFileSync('test/fixtures/persona-ana.pdf', await page.pdf({ format: 'A4' }));
const png = (await page.screenshot({ fullPage: false })).toString('base64');
await page.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png}" style="width:100%"></body></html>`);
writeFileSync('test/fixtures/persona-scan.pdf', await page.pdf({ format: 'A4', printBackground: true }));

// Extra personas for the extraction-quality eval (SC-002): varied layout, language, date styles.
const doc = (body: string, lang = 'pt-BR', css = '') =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;margin:30px 40px}h2{font-size:12pt;margin:14px 0 4px}${css}</style></head><body>${body}</body></html>`;
const personas: Record<string, string> = {
  'persona-bruno': doc(
    `<h1>Bruno Lima</h1><p>Tech Lead · Recife, PE · bruno.lima@example.com · +55 81 90000-1111 · github.com/bruno-example</p>
<h2>Experience</h2><p><b>Tech Lead</b>, Nimbus Pagamentos S.A. (Jan 2022 – Present)</p><ul><li>Led a team of 6 engineers building a Go and Kafka event platform.</li><li>Moved CI to GitHub Actions and Terraform.</li></ul>
<p><b>Backend Engineer</b>, Rocket Delivery (2019 – 2021)</p><ul><li>Built Django REST APIs on AWS.</li></ul>
<h2>Education</h2><p>BSc Computer Engineering — Universidade Federal de Pernambuco, 2014 – 2018</p>
<h2>Skills</h2><p>Go, Kafka, Python, Django, AWS, Terraform, Kubernetes</p><h2>Languages</h2><p>Portuguese (native), English (fluent)</p>`,
    'en',
  ),
  'persona-carla': doc(
    `<div style="display:flex;gap:24px"><div style="width:30%"><h1 style="font-size:18pt">Carla Mendes</h1><p>Cientista de Dados</p><p>carla.mendes@example.com</p><p>(31) 90000-2222</p><p>Belo Horizonte - MG</p>
<h2>Competências</h2><p>Python</p><p>pandas</p><p>scikit-learn</p><p>PyTorch</p><p>SQL</p><h2>Idiomas</h2><p>Inglês intermediário</p></div>
<div style="width:70%"><h2>Experiência</h2><p><b>Cientista de Dados Pleno</b> — Banco Horizonte</p><p>Setembro de 2020 até o momento</p><ul><li>Modelos de churn com scikit-learn em produção.</li></ul>
<p><b>Analista de Dados</b> — Varejo Mais Ltda.</p><p>02/2018 – 08/2020</p><ul><li>Dashboards em SQL e Power BI.</li></ul>
<h2>Formação</h2><p>Mestrado em Estatística — UFMG (2016 – 2018)</p><p>Bacharelado em Matemática — UFMG (2012 – 2015)</p></div></div>`,
  ),
  'persona-diego': doc(
    `<h1>Diego Rocha</h1><p>Desenvolvedor Front-end Júnior | Curitiba/PR | diego.rocha@example.com | 41 90000-3333</p>
<h2>Experiência</h2><p>Estagiário de Desenvolvimento — Agência Pixel (2023 - 2024)</p><ul><li>Landing pages em React e Tailwind CSS.</li></ul>
<h2>Projetos</h2><p><b>FinTrack</b> — app de finanças pessoais com Next.js e Supabase.</p><p><b>Clima Já</b> — PWA de previsão do tempo em Vue.js.</p>
<h2>Formação</h2><p>Tecnologia em Análise e Desenvolvimento de Sistemas — UTFPR, 2021 – 2024</p>
<h2>Cursos e Certificações</h2><p>Scrum Foundation Professional Certificate (CertiProf)</p>
<h2>Habilidades</h2><p>JavaScript · TypeScript · React · Next.js · Vue.js · Tailwind CSS · Git</p>`,
  ),
  'persona-elisa': doc(
    `<h1>Elisa Prado</h1><p>Engenheira DevOps/SRE — Florianópolis, SC — elisa.prado@example.com — +55 48 90000-4444</p>
<table style="width:100%;border-collapse:collapse"><tr><td style="width:25%;vertical-align:top">2021 – atual</td><td><b>SRE Sênior · Nuvem Azul</b><br>Kubernetes, Prometheus e Grafana para 300 serviços.</td></tr>
<tr><td style="vertical-align:top">2017 – 2021</td><td><b>Analista de Infraestrutura · Datacenter Sul</b><br>Automação com Ansible e Linux.</td></tr></table>
<h2>Certificações</h2><p>Certified Kubernetes Administrator (CKA) — CNCF</p><p>AWS Certified Solutions Architect – Associate — Amazon Web Services</p>
<h2>Formação</h2><p>Engenharia de Computação — UFSC (2012–2016)</p>
<h2>Ferramentas</h2><p>Kubernetes, Docker, Terraform, Ansible, Prometheus, Grafana, Linux, Bash</p>`,
  ),
};
for (const [name, body] of Object.entries(personas)) {
  await page.setContent(body);
  writeFileSync(`test/fixtures/${name}.pdf`, await page.pdf({ format: 'A4' }));
}
await browser.close();
console.log('fixtures written');

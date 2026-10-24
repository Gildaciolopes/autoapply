"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Preferences, Seniority, SourceView, WorkMode } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ApiRequestError, errorMessage, evals, jobSources, preferences } from "@/lib/api";
import { checkboxClass, fmtDateTime, nativeSelectClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { SENIORITY_LABEL, SOURCE_LABEL, WORK_MODE_LABEL, cronHour } from "./format";
import { TagInput } from "./tag-input";

export function PreferencesView() {
  const { data, loading } = useLoad(() => preferences.get());
  return (
    <div className="space-y-6">
      {loading && !data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && <PreferencesForm initial={data} />}
      <SourcesTable />
      <EvalCard />
    </div>
  );
}

const SENIORITIES = Object.keys(SENIORITY_LABEL) as Seniority[];
const WORK_MODES = Object.keys(WORK_MODE_LABEL) as WorkMode[];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function toggleIn<T>(list: T[], item: T, on: boolean): T[] {
  return on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);
}

function PreferencesForm({ initial }: { initial: Preferences }) {
  const [form, setForm] = useState<Preferences>(initial);
  const [busy, setBusy] = useState<"save" | "suggest" | null>(null);
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setForm((f) => ({ ...f, [k]: v }));
  const hour = cronHour(form.discoveryCron);

  async function suggest() {
    setBusy("suggest");
    try {
      const s = await preferences.suggest();
      setForm((f) => ({ ...s, saved: f.saved }));
      toast.success("Sugestão aplicada — revise e salve");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const { prefs, refiltered } = await preferences.put(form);
      setForm(prefs);
      toast.success(`Preferências salvas — ${refiltered} vaga(s) refiltrada(s)`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Preferências de busca</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void suggest()}>
              {busy === "suggest" ? "Sugerindo…" : "Sugerir do meu perfil"}
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => void save()}>
              {busy === "save" ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
        {!form.saved && (
          <p className="text-muted-foreground text-sm">
            Preferências ainda não salvas — preencha (ou use &quot;Sugerir do meu perfil&quot;) e salve antes da primeira busca.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Cargos" htmlFor="roles" hint="Digite e pressione Enter.">
            <TagInput id="roles" value={form.roles} onChange={(v) => set("roles", v)} placeholder="ex.: Desenvolvedor Full-Stack" />
          </Field>
          <Field label="Stack" htmlFor="stack">
            <TagInput id="stack" value={form.stack} onChange={(v) => set("stack", v)} placeholder="ex.: TypeScript" />
          </Field>
          <Field label="Locais" htmlFor="locations" hint='"Cidade/UF", "UF" ou "remote"'>
            <TagInput id="locations" value={form.locations} onChange={(v) => set("locations", v)} placeholder="ex.: Salvador/BA" />
          </Field>
          <Field label="Empresas bloqueadas" htmlFor="blocked">
            <TagInput id="blocked" value={form.blockedCompanies} onChange={(v) => set("blockedCompanies", v)} />
          </Field>
          <Field label="Palavras excluídas" htmlFor="exclude" hint="Vagas com estas palavras no título/descrição são filtradas.">
            <TagInput id="exclude" value={form.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} />
          </Field>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Senioridade</legend>
            <div className="flex flex-wrap gap-4">
              {SENIORITIES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={form.seniority.includes(s)}
                    onChange={(e) => set("seniority", toggleIn(form.seniority, s, e.target.checked))}
                  />
                  {SENIORITY_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Modalidade</legend>
            <div className="flex flex-wrap gap-4">
              {WORK_MODES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={form.workModes.includes(m)}
                    onChange={(e) => set("workModes", toggleIn(form.workModes, m, e.target.checked))}
                  />
                  {WORK_MODE_LABEL[m]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Salário mínimo (R$/mês)" htmlFor="minSalary">
            <div className="flex gap-2">
              <Input
                id="minSalary"
                type="number"
                min={1}
                step={500}
                value={form.minSalary ?? ""}
                onChange={(e) => {
                  const n = Math.trunc(Number(e.target.value));
                  set("minSalary", e.target.value === "" || !Number.isFinite(n) || n <= 0 ? null : n);
                }}
              />
              <select
                aria-label="Contrato do salário mínimo"
                className={nativeSelectClass}
                value={form.minSalaryContract ?? ""}
                onChange={(e) => set("minSalaryContract", (e.target.value || null) as Preferences["minSalaryContract"])}
              >
                <option value="">—</option>
                <option value="clt">CLT</option>
                <option value="pj">PJ</option>
                <option value="any">Qualquer</option>
              </select>
            </div>
          </Field>
          <Field label="Avaliar em detalhe as N melhores por busca" htmlFor="judgeTopN" hint="LLM local; 0 desativa (0–50).">
            <Input
              id="judgeTopN"
              type="number"
              min={0}
              max={50}
              value={form.judgeTopN}
              onChange={(e) => set("judgeTopN", Math.min(50, Math.max(0, Math.trunc(Number(e.target.value) || 0))))}
            />
          </Field>
          <Field label="Busca automática diária" htmlFor="autoDiscover">
            <div className="flex h-8 items-center gap-3">
              <Switch id="autoDiscover" checked={form.autoDiscover} onCheckedChange={(v) => set("autoDiscover", v)} />
              <select
                aria-label="Horário da busca automática"
                className={nativeSelectClass}
                disabled={!form.autoDiscover}
                value={hour ?? "custom"}
                onChange={(e) => {
                  if (e.target.value !== "custom") set("discoveryCron", `0 ${e.target.value} * * *`);
                }}
              >
                {hour === null && <option value="custom">cron: {form.discoveryCron}</option>}
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Adaptação de currículo</legend>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={form.autoTailor} onCheckedChange={(v) => set("autoTailor", v)} />
            Adaptar automaticamente as melhores vagas após cada busca
          </label>
          <div className="grid gap-5 md:grid-cols-3">
            <Field label="Quantas vagas adaptar por busca" htmlFor="autoTailorN" hint="1–20.">
              <Input
                id="autoTailorN"
                type="number"
                min={1}
                max={20}
                disabled={!form.autoTailor}
                value={form.autoTailorN}
                onChange={(e) => set("autoTailorN", Math.min(20, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
              />
            </Field>
            <Field label="Nota mínima" htmlFor="scoreThreshold" hint="Só adapta vagas com score ≥ esta nota (0–100).">
              <Input
                id="scoreThreshold"
                type="number"
                min={0}
                max={100}
                value={form.scoreThreshold}
                onChange={(e) => set("scoreThreshold", Math.min(100, Math.max(0, Math.trunc(Number(e.target.value) || 0))))}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Candidatura</legend>
          <div className="grid gap-5 md:grid-cols-3">
            <Field
              label="Modo"
              htmlFor="applyMode"
              hint={form.mode === "review" ? "Envia de verdade só as candidaturas que você aprovar." : "Nada é enviado; só simula e fotografa."}
            >
              <select
                id="applyMode"
                className={nativeSelectClass}
                value={form.mode}
                onChange={(e) => set("mode", e.target.value as Preferences["mode"])}
              >
                <option value="dry_run">Simulação (nunca envia)</option>
                <option value="review">Revisão (envia só o que você aprovar)</option>
                <option value="autopilot" disabled>
                  Autopilot (indisponível)
                </option>
              </select>
            </Field>
            <Field label="Confiança mínima (%)" htmlFor="applyConfidence" hint="Abaixo disso a pergunta vai para 'Precisa de você'">
              <Input
                id="applyConfidence"
                type="number"
                min={0}
                max={100}
                value={Math.round(form.applyConfidence * 100)}
                onChange={(e) => set("applyConfidence", Math.min(100, Math.max(0, Math.trunc(Number(e.target.value) || 0))) / 100)}
              />
            </Field>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

// ---------- sources ----------

function SourcesTable() {
  const { data, setData, loading } = useLoad(() => jobSources.list());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLinkedin, setConfirmLinkedin] = useState(false);

  function replace(s: SourceView) {
    setData((prev) => prev?.map((x) => (x.type === s.type ? s : x)));
  }

  async function patch(s: SourceView, body: { enabled?: boolean; dailyCap?: number; acceptTerms?: boolean }) {
    setBusy(s.type);
    try {
      replace(await jobSources.patch(s.type, body));
      if (body.acceptTerms) setConfirmLinkedin(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "terms_required") setConfirmLinkedin(true);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function onToggle(s: SourceView, enabled: boolean) {
    if (s.type === "linkedin_mcp" && enabled) {
      setConfirmLinkedin(true);
      return;
    }
    void patch(s, { enabled });
  }

  const linkedin = data?.find((s) => s.type === "linkedin_mcp");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fontes de vagas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !data && <p className="text-muted-foreground text-sm">Carregando…</p>}
        {data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Ativa</TableHead>
                <TableHead>Limite diário</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead>Última execução</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.type}>
                  <TableCell className="font-medium">{SOURCE_LABEL[s.type]}</TableCell>
                  <TableCell>
                    <Switch checked={s.enabled} disabled={busy !== null} onCheckedChange={(v) => onToggle(s, v)} />
                  </TableCell>
                  <TableCell>
                    <CapInput key={`${s.type}:${s.dailyCap}`} source={s} disabled={busy !== null} onSave={(cap) => void patch(s, { dailyCap: cap })} />
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    usados hoje: {s.usedToday}/{s.dailyCap}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>
                      {s.lastStatus ?? "—"} · {fmtDateTime(s.lastRunAt)}
                    </div>
                    {s.lastError && <div className="text-destructive max-w-xs truncate text-xs" title={s.lastError}>{s.lastError}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {confirmLinkedin && linkedin && (
          <div className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium">Ativar LinkedIn?</p>
            <p>{linkedin.warning ?? "Os termos do LinkedIn proíbem automação; use por sua conta e risco."}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => void patch(linkedin, { enabled: true, acceptTerms: true })}>
                Entendo e quero ativar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLinkedin(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CapInput({ source, disabled, onSave }: { source: SourceView; disabled: boolean; onSave: (cap: number) => void }) {
  const [value, setValue] = useState(String(source.dailyCap));
  return (
    <Input
      type="number"
      min={0}
      max={200}
      className="w-24"
      aria-label={`Limite diário ${SOURCE_LABEL[source.type]}`}
      disabled={disabled}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const n = Math.trunc(Number(value));
        if (value === "" || !Number.isFinite(n) || n < 0 || n > 200) {
          toast.error("Limite deve estar entre 0 e 200");
          setValue(String(source.dailyCap));
          return;
        }
        if (n !== source.dailyCap) onSave(n);
      }}
    />
  );
}

// ---------- tailoring eval ----------

function EvalCard() {
  const { data, loading } = useLoad(() => evals.runs("tailor"));
  const last = data?.[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Avaliação anti-invenção</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {loading && !data && <p className="text-muted-foreground">Carregando…</p>}
        {data && !last && (
          <p className="text-muted-foreground">
            Nenhuma avaliação ainda — rode <code className="bg-muted rounded px-1">make eval</code>.
          </p>
        )}
        {last && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {last.passed ? (
              <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">passou</Badge>
            ) : (
              <Badge variant="destructive">falhou</Badge>
            )}
            <span>{fmtDateTime(last.createdAt)}</span>
            <span className="text-muted-foreground">modelo {last.model}</span>
            <span>{last.cases} casos</span>
            <span className={last.fabrications > 0 ? "text-destructive font-medium" : ""}>
              {last.fabrications} {last.fabrications === 1 ? "invenção" : "invenções"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

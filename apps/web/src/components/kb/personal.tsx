"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PersonalFacts } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage, personal } from "@/lib/api";
import { checkboxClass, nativeSelectClass } from "./format";
import { useLoad } from "./use-load";

type Salary = NonNullable<PersonalFacts["salaryExpectation"]>;
type WorkMode = PersonalFacts["workModes"][number];

const WORK_MODES: [WorkMode, string][] = [
  ["remote", "Remoto"],
  ["hybrid", "Híbrido"],
  ["onsite", "Presencial"],
];

export function PersonalForm() {
  const { data, loading } = useLoad(personal.get);
  if (!data) return <p className="text-muted-foreground text-sm">{loading ? "Carregando…" : "Não foi possível carregar."}</p>;
  return <PersonalEditor initial={data} />;
}

function PersonalEditor({ initial }: { initial: PersonalFacts }) {
  const [form, setForm] = useState<PersonalFacts>(initial);
  // Salary is edited as loose fields; empty amount = null (not provided).
  const [amount, setAmount] = useState(initial.salaryExpectation ? String(initial.salaryExpectation.amount) : "");
  const [salary, setSalary] = useState<Omit<Salary, "amount">>({
    currency: initial.salaryExpectation?.currency ?? "BRL",
    contract: initial.salaryExpectation?.contract ?? "clt",
    period: initial.salaryExpectation?.period ?? "month",
  });
  const [notice, setNotice] = useState(initial.noticePeriodDays === null ? "" : String(initial.noticePeriodDays));
  const [others, setOthers] = useState(initial.workAuthorization.others.join(", "));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PersonalFacts>(k: K, v: PersonalFacts[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replace(",", "."));
    const body: PersonalFacts = {
      ...form,
      salaryExpectation: amount.trim() && amt > 0 ? { amount: amt, ...salary } : null,
      noticePeriodDays: notice.trim() ? Number.parseInt(notice, 10) : null,
      pcdDetails: form.pcdDetails?.trim() ? form.pcdDetails : null,
      workAuthorization: {
        brazil: form.workAuthorization.brazil,
        others: others
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };
    setSaving(true);
    try {
      const saved = await personal.put(body);
      setForm(saved);
      toast.success("Dados pessoais salvos");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Campos vazios ficam como “Não informado” e nunca viram “sim/não” automaticamente.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pretensão salarial</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 text-sm">
          <Field label="Valor">
            <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" placeholder="não informado" />
          </Field>
          <Field label="Moeda">
            <select className={nativeSelectClass} value={salary.currency} onChange={(e) => setSalary({ ...salary, currency: e.target.value as Salary["currency"] })}>
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
          <Field label="Contrato">
            <select className={nativeSelectClass} value={salary.contract} onChange={(e) => setSalary({ ...salary, contract: e.target.value as Salary["contract"] })}>
              <option value="clt">CLT</option>
              <option value="pj">PJ</option>
              <option value="both">Ambos</option>
            </select>
          </Field>
          <Field label="Período">
            <select className={nativeSelectClass} value={salary.period} onChange={(e) => setSalary({ ...salary, period: e.target.value as Salary["period"] })}>
              <option value="month">por mês</option>
              <option value="year">por ano</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disponibilidade</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-6 text-sm">
          <Field label="Aviso prévio (dias)">
            <Input type="number" min={0} value={notice} onChange={(e) => setNotice(e.target.value)} className="w-28" placeholder="não informado" />
          </Field>
          <Field label="Disponível a partir de">
            <Input type="date" value={form.availableFrom ?? ""} onChange={(e) => set("availableFrom", e.target.value || null)} className="w-44" />
          </Field>
          <Field label="Modelos de trabalho">
            <div className="flex h-8 items-center gap-4">
              {WORK_MODES.map(([m, label]) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={form.workModes.includes(m)}
                    onChange={(e) =>
                      set("workModes", e.target.checked ? [...form.workModes, m] : form.workModes.filter((x) => x !== m))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Mudança de cidade">
            <select className={nativeSelectClass} value={form.relocate} onChange={(e) => set("relocate", e.target.value as PersonalFacts["relocate"])}>
              <option value="not_provided">Não informado</option>
              <option value="yes">Sim</option>
              <option value="no">Não</option>
              <option value="depends">Depende</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">PcD e autorização de trabalho</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-6 text-sm">
          <Field label="Pessoa com deficiência (PcD)">
            <select className={nativeSelectClass} value={form.pcd} onChange={(e) => set("pcd", e.target.value as PersonalFacts["pcd"])}>
              <option value="not_provided">Não informado</option>
              <option value="yes">Sim</option>
              <option value="no">Não</option>
              <option value="prefer_not">Prefiro não informar</option>
            </select>
          </Field>
          <Field label="Detalhes PcD">
            <Input value={form.pcdDetails ?? ""} onChange={(e) => set("pcdDetails", e.target.value || null)} className="w-64" />
          </Field>
          <Field label="Autorização no Brasil">
            <select
              className={nativeSelectClass}
              value={form.workAuthorization.brazil}
              onChange={(e) =>
                set("workAuthorization", { ...form.workAuthorization, brazil: e.target.value as PersonalFacts["workAuthorization"]["brazil"] })
              }
            >
              <option value="not_provided">Não informado</option>
              <option value="citizen">Cidadã(o) brasileira(o)</option>
              <option value="permanent">Residente permanente</option>
              <option value="visa">Visto de trabalho</option>
            </select>
          </Field>
          <Field label="Outros países (separados por vírgula)">
            <Input value={others} onChange={(e) => setOthers(e.target.value)} className="w-64" placeholder="ex.: Portugal, UE" />
          </Field>
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving}>
        {saving ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-muted-foreground block text-xs">{label}</span>
      {children}
    </label>
  );
}

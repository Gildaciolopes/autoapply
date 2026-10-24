"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { NightSettings } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiRequestError, errorMessage, night } from "@/lib/api";
import { DAY_LABELS, TELEGRAM_MISSING, fmtWhen } from "./format";

type Form = Pick<NightSettings, "enabled" | "start" | "end" | "days" | "budget">;

/** Night window settings (F6 T011). Mount with a `key` that changes when the saved settings change. */
export function NightSettingsCard({ settings, onSaved }: { settings: NightSettings; onSaved: (s: NightSettings) => void }) {
  const [form, setForm] = useState<Form>({
    enabled: settings.enabled,
    start: settings.start,
    end: settings.end,
    days: settings.days,
    budget: settings.budget,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d: number) =>
    set("days", form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort((a, b) => a - b));

  const invalid =
    form.days.length === 0 ? "Escolha ao menos um dia" : form.start === form.end ? "Início e fim não podem ser iguais" : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const s = await night.saveSettings(form);
      toast.success("Configuração salva");
      onSaved(s);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 400 || err.status === 422)) setError(err.message);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function testTelegram() {
    setTesting(true);
    try {
      const r = await night.testTelegram();
      if (r.status === "sent") toast.success("Mensagem de teste enviada no Telegram");
      else if (r.status === "not_configured") toast.warning(TELEGRAM_MISSING);
      else toast.error(`Falha ao enviar no Telegram: ${r.error ?? "erro desconhecido"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Janela noturna</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="flex items-center gap-3">
          <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
          <span className="font-medium">Execução noturna</span>
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="nightStart">Início</Label>
            <Input id="nightStart" type="time" className="w-32" value={form.start} onChange={(e) => set("start", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nightEnd">Fim</Label>
            <Input id="nightEnd" type="time" className="w-32" value={form.end} onChange={(e) => set("end", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nightBudget">Candidaturas por noite (1–40)</Label>
            <Input
              id="nightBudget"
              type="number"
              min={1}
              max={40}
              className="w-24"
              value={form.budget}
              onChange={(e) => set("budget", Math.min(40, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="font-medium">Dias</span>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((label, d) => {
              const on = form.days.includes(d);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {(error || invalid) && <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-3">{error ?? invalid}</div>}

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={saving || invalid !== null} onClick={() => void save()}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
          <Button variant="outline" disabled={testing} onClick={() => void testTelegram()}>
            {testing ? "Testando…" : "Testar Telegram"}
          </Button>
          {!settings.telegram && <span className="text-muted-foreground text-xs">{TELEGRAM_MISSING}</span>}
        </div>

        <p className="text-muted-foreground">
          Próxima execução:{" "}
          <span className="text-foreground font-medium">
            {settings.paused
              ? "pausado — clique em Retomar no topo"
              : settings.next
                ? `${fmtWhen(settings.next.start)} até ${fmtWhen(settings.next.end)}`
                : "nenhuma (execução noturna desligada)"}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

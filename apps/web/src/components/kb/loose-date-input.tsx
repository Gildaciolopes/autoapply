"use client";

import type { LooseDate } from "@autoapply/shared";
import { MONTHS, checkboxClass, nativeSelectClass } from "./format";

/** Year + optional month + "Atual". Never invents a month: empty month keeps year precision. */
export function LooseDateInput({
  value,
  onChange,
  allowPresent = true,
}: {
  value: LooseDate | null | undefined;
  onChange: (v: LooseDate | null) => void;
  allowPresent?: boolean;
}) {
  const present = value === "present";
  const d = value && value !== "present" ? value : null;

  function setYear(raw: string) {
    const year = Number.parseInt(raw, 10);
    if (!raw || Number.isNaN(year)) return onChange(null);
    onChange(d?.month ? { year, month: d.month, precision: "month" } : { year, precision: "year" });
  }

  function setMonth(raw: string) {
    if (!d) return;
    const month = Number.parseInt(raw, 10);
    onChange(raw ? { year: d.year, month, precision: "month" } : { year: d.year, precision: "year" });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={1950}
        max={2100}
        placeholder="ano"
        disabled={present}
        value={d?.year ?? ""}
        onChange={(e) => setYear(e.target.value)}
        className={`${nativeSelectClass} w-20`}
      />
      <select
        disabled={present || !d}
        value={d?.month ?? ""}
        onChange={(e) => setMonth(e.target.value)}
        className={nativeSelectClass}
        aria-label="mês"
      >
        <option value="">— mês —</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      {allowPresent && (
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={present}
            onChange={(e) => onChange(e.target.checked ? "present" : null)}
          />
          Atual
        </label>
      )}
    </div>
  );
}

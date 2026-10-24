"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RunEventView, WindowView } from "@autoapply/shared";
import { night } from "@/lib/api";
import { fmtClock, fmtWhen } from "./format";

const MAX_EVENTS = 1000;

const LEVEL_CLASS: Record<string, string> = {
  info: "text-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
};

function merge(a: RunEventView[], b: RunEventView[]): RunEventView[] {
  const bySeq = new Map<number, RunEventView>();
  for (const e of a) bySeq.set(e.seq, e);
  for (const e of b) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq).slice(-MAX_EVENTS);
}

/**
 * Live log of one night run (F6 T033). Starts from the run view's events, then follows the SSE stream
 * while the run is running (EventSource resends Last-Event-ID on reconnect; rows are deduped by seq).
 * Mount with `key={runId}` so a different run starts from a clean stream.
 */
export function LiveLog({
  runId,
  initial,
  running,
  next,
  onEnd,
}: {
  runId: string;
  initial: RunEventView[];
  running: boolean;
  next: WindowView | null;
  onEnd?: () => void;
}) {
  const [streamed, setStreamed] = useState<RunEventView[]>([]);
  const [connected, setConnected] = useState(false);
  const events = useMemo(() => merge(initial, streamed), [initial, streamed]);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const initialRef = useRef(initial);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    initialRef.current = initial;
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    if (!running) return;
    const after = initialRef.current.reduce((m, e) => Math.max(m, e.seq), 0);
    const es = new EventSource(night.eventsUrl(runId, after));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // the browser reconnects on its own
    es.addEventListener("event", (msg: MessageEvent<string>) => {
      try {
        const e = JSON.parse(msg.data) as RunEventView;
        setStreamed((prev) => (prev.some((p) => p.seq === e.seq) ? prev : merge(prev, [e])));
      } catch {
        // malformed frame: ignore
      }
    });
    es.addEventListener("end", () => {
      es.close();
      setConnected(false);
      onEndRef.current?.();
    });
    return () => es.close();
  }, [runId, running]);

  // Auto-scroll while the user is at the bottom.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [events]);

  const onScroll = () => {
    const box = boxRef.current;
    if (box) stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        {running ? (
          <span className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${connected ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
            {connected ? "Ao vivo" : "Reconectando…"}
          </span>
        ) : (
          <span className="text-muted-foreground">Sem execução em andamento — próxima: {next ? fmtWhen(next.start) : "nenhuma agendada"}</span>
        )}
        <span className="text-muted-foreground ml-auto">{events.length} evento(s)</span>
      </div>
      <div ref={boxRef} onScroll={onScroll} className="bg-muted/30 h-80 overflow-y-auto rounded-lg border p-2 font-mono text-xs" aria-live="polite">
        {events.length === 0 && <p className="text-muted-foreground">Nenhum evento ainda.</p>}
        {events.map((e) => (
          <div key={e.seq} className={`flex gap-2 ${LEVEL_CLASS[e.level] ?? ""}`}>
            <span className="text-muted-foreground shrink-0">{fmtClock(e.at)}</span>
            {e.step && <span className="text-muted-foreground shrink-0">[{e.step}]</span>}
            <span className="break-words">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

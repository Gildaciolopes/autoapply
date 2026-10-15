"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";

/**
 * Loads data on mount (and whenever `key` changes), exposes `reload`, and polls every `pollMs`
 * while `shouldPoll(data)` is true (re-evaluated after every load). Errors become toasts.
 */
export function useLoad<T>(
  loader: () => Promise<T>,
  key: string = "",
  opts: { pollMs?: number; shouldPoll?: (data: T) => boolean } = {},
) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  const optsRef = useRef(opts);
  useEffect(() => {
    loaderRef.current = loader;
    optsRef.current = opts;
  });

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await loaderRef.current();
      setData(d);
      return d;
    } catch (err) {
      toast.error(errorMessage(err));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loaderRef.current().then(
      (d) => {
        if (!cancelled) setData(d);
      },
      (err: unknown) => {
        if (!cancelled) toast.error(errorMessage(err));
      },
    ).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    const { pollMs, shouldPoll } = optsRef.current;
    if (!pollMs || data === undefined || !shouldPoll?.(data)) return;
    const t = setTimeout(() => void reload(true), pollMs);
    return () => clearTimeout(t);
  }, [data, reload]);

  return { data, setData, loading, reload };
}

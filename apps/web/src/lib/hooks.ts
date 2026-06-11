import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads data on mount / dependency change, with manual reload support. */
export function useApi<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options?: { refreshMs?: number },
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    if (!options?.refreshMs) return;
    const timer = setInterval(() => setTick((t) => t + 1), options.refreshMs);
    return () => clearInterval(timer);
  }, [options?.refreshMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

/** Wraps an async action with busy/error state for forms and buttons. */
export function useAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
): { run: (...args: Args) => void; busy: boolean; error: string | null; clearError: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (...args: Args) => {
      setBusy(true);
      setError(null);
      action(...args)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action],
  );

  return { run, busy, error, clearError: () => setError(null) };
}

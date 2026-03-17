import { useState, useEffect, useCallback } from "react";
import type { StatusResponse, KeysResponse } from "../types.js";

export function useStatus(refreshInterval = 5000) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [keys, setKeys] = useState<KeysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, keysRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/keys"),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json() as StatusResponse);
      if (keysRes.ok) setKeys(await keysRes.json() as KeysResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), refreshInterval);
    return () => clearInterval(id);
  }, [fetchAll, refreshInterval]);

  return { status, keys, error, refetch: fetchAll };
}

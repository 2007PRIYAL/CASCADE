import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  VisualizationSnapshot,
  StatusResponse,
  BurnsResponse,
  BurnCounterfactualResponse,
  ConjunctionsResponse,
  TrajectoryResponse,
} from '../types/api';
import { simulationEngine } from '../data/simulationEngine';

const API_BASE = '';  // proxied via vite dev server

let backendOnline = false;
let lastProbeTime = 0;
const PROBE_INTERVAL_MS = 10000;

async function probeBackend(): Promise<boolean> {
  const now = Date.now();
  if (now - lastProbeTime < PROBE_INTERVAL_MS) {
    return backendOnline;
  }
  lastProbeTime = now;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1200);
  try {
    const res = await fetch(`${API_BASE}/api/status`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    backendOnline = res.ok;
  } catch {
    clearTimeout(timer);
    backendOnline = false;
  }
  simulationEngine.isFallbackActive = !backendOnline;
  return backendOnline;
}

export function useSnapshot(intervalMs = 1000) {
  const [snapshot, setSnapshot] = useState<VisualizationSnapshot | null>(() => simulationEngine.getSnapshot());
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSnapshot = useCallback(async () => {
    const isOnline = await probeBackend();
    if (!isOnline) {
      setSnapshot(simulationEngine.getSnapshot());
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${API_BASE}/api/visualization/snapshot`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VisualizationSnapshot = await res.json();
      setSnapshot(data);
      setError(null);
      backendOnline = true;
      simulationEngine.isFallbackActive = false;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        backendOnline = false;
        simulationEngine.isFallbackActive = true;
        setSnapshot(simulationEngine.getSnapshot());
        setError(null);
      }
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchSnapshot, intervalMs]);

  return { snapshot, error };
}

export function useStatus(intervalMs = 2000) {
  const [status, setStatus] = useState<StatusResponse | null>(() => simulationEngine.getStatus());
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    const isOnline = await probeBackend();
    if (!isOnline) {
      setStatus(simulationEngine.getStatus());
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${API_BASE}/api/status?details=1`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatusResponse = await res.json();
      setStatus(data);
      setError(null);
      backendOnline = true;
      simulationEngine.isFallbackActive = false;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        backendOnline = false;
        simulationEngine.isFallbackActive = true;
        setStatus(simulationEngine.getStatus());
        setError(null);
      }
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchStatus, intervalMs]);

  return { status, error };
}

export function useBurns(intervalMs = 2000) {
  const [burns, setBurns] = useState<BurnsResponse | null>(() => simulationEngine.getBurns());
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBurns = useCallback(async () => {
    const isOnline = await probeBackend();
    if (!isOnline) {
      setBurns(simulationEngine.getBurns());
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${API_BASE}/api/debug/burns`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BurnsResponse = await res.json();
      setBurns(data);
      setError(null);
      backendOnline = true;
      simulationEngine.isFallbackActive = false;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        backendOnline = false;
        simulationEngine.isFallbackActive = true;
        setBurns(simulationEngine.getBurns());
        setError(null);
      }
    }
  }, []);

  useEffect(() => {
    fetchBurns();
    const id = setInterval(fetchBurns, intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchBurns, intervalMs]);

  return { burns, error };
}

export function useConjunctions(
  intervalMs = 2000,
  satelliteId?: string,
  source?: 'history' | 'predicted' | 'combined',
) {
  const [conjunctions, setConjunctions] = useState<ConjunctionsResponse | null>(() =>
    simulationEngine.getConjunctions(satelliteId, source)
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchConjunctions = useCallback(async () => {
    const isOnline = await probeBackend();
    if (!isOnline) {
      setConjunctions(simulationEngine.getConjunctions(satelliteId, source));
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const search = new URLSearchParams();
      if (satelliteId) search.set('satellite_id', satelliteId);
      if (source) search.set('source', source);
      const params = search.size > 0 ? `?${search.toString()}` : '';
      const res = await fetch(`${API_BASE}/api/debug/conjunctions${params}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ConjunctionsResponse = await res.json();
      setConjunctions(data);
      setError(null);
      backendOnline = true;
      simulationEngine.isFallbackActive = false;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        backendOnline = false;
        simulationEngine.isFallbackActive = true;
        setConjunctions(simulationEngine.getConjunctions(satelliteId, source));
        setError(null);
      }
    }
  }, [satelliteId, source]);

  useEffect(() => {
    fetchConjunctions();
    const id = setInterval(fetchConjunctions, intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchConjunctions, intervalMs]);

  return { conjunctions, error };
}

export function useTrajectory(satelliteId: string | null, intervalMs = 2000) {
  const [trajectory, setTrajectory] = useState<TrajectoryResponse | null>(() =>
    satelliteId ? simulationEngine.getTrajectory(satelliteId) : null
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!satelliteId) {
      setTrajectory(null);
      return;
    }
    const fetchTrajectory = async () => {
      const isOnline = await probeBackend();
      if (!isOnline) {
        setTrajectory(simulationEngine.getTrajectory(satelliteId));
        setError(null);
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch(`${API_BASE}/api/visualization/trajectory?satellite_id=${encodeURIComponent(satelliteId)}`, {
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: TrajectoryResponse = await res.json();
        setTrajectory(data);
        setError(null);
        backendOnline = true;
        simulationEngine.isFallbackActive = false;
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          backendOnline = false;
          simulationEngine.isFallbackActive = true;
          setTrajectory(simulationEngine.getTrajectory(satelliteId));
          setError(null);
        }
      }
    };
    fetchTrajectory();
    const id = setInterval(fetchTrajectory, intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [intervalMs, satelliteId]);

  return { trajectory, error };
}

export function useBurnCounterfactual(burnId: string | null) {
  const [counterfactual, setCounterfactual] = useState<BurnCounterfactualResponse | null>(() =>
    burnId ? simulationEngine.getBurnCounterfactual(burnId) : null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!burnId) {
      setCounterfactual(null);
      setError(null);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }

    const fetchCounterfactual = async () => {
      const isOnline = await probeBackend();
      if (!isOnline) {
        setCounterfactual(simulationEngine.getBurnCounterfactual(burnId));
        setError(null);
        setLoading(false);
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/debug/burn-counterfactual?burn_id=${encodeURIComponent(burnId)}`, {
          signal: abortRef.current.signal,
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const payload = await res.json() as { message?: string };
            if (payload?.message) detail = payload.message;
          } catch {
            // Fall back to HTTP status
          }
          throw new Error(detail);
        }
        const data: BurnCounterfactualResponse = await res.json();
        setCounterfactual(data);
        setError(null);
        backendOnline = true;
        simulationEngine.isFallbackActive = false;
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          backendOnline = false;
          simulationEngine.isFallbackActive = true;
          setCounterfactual(simulationEngine.getBurnCounterfactual(burnId));
          setError(null);
        }
      } finally {
        if (!abortRef.current?.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchCounterfactual();
    return () => {
      abortRef.current?.abort();
    };
  }, [burnId]);

  return { counterfactual, error, loading };
}

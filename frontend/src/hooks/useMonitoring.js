import { useCallback, useEffect, useRef, useState } from "react";
import api, { apiMessage } from "../api";

export default function useMonitoring(interval = 10000) {
  const [metrics, setMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const snapshot = await api.get("/monitoring/snapshot");
      setMetrics(snapshot.data.metrics);
      setError("");
      setPaused(false);
      const samples = await api.get("/monitoring/history?limit=60");
      setHistory((samples.data.metrics || []).map((item) => ({
        ...item,
        label: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        network: ((item.network?.received || 0) + (item.network?.sent || 0)) / 1024 / 1024,
      })));
    } catch (err) {
      setError(apiMessage(err));
      setPaused(err.response?.status === 423);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let timer;
    let disposed = false;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = window.setTimeout(poll, interval);
    };
    poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [refresh, interval]);
  return { metrics, history, error, loading, paused, refresh };
}

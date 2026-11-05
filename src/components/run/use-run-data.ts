"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StudioDataSchema, type StudioData } from "@/domain/studio-data";
import { refreshReconciliation } from "@/server/actions/refresh-reconciliation";

type LiveState = "connecting" | "live" | "offline";

/**
 * Keeps the dashboard data fresh.
 *  - starts from the data the server page already loaded
 *  - `refresh()` refetches /api/runs/[id]/studio-data (call it after an action)
 *  - listens to /api/runs/[id]/events and refetches when the server says something changed
 */
export function useRunData(initial: StudioData) {
  const runId = initial.run.id;
  const [fetched, setFetched] = useState<StudioData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("connecting");

  // whichever copy is newer wins (the server page re-renders after a persona switch)
  const data = fetched && fetched.generatedAt > initial.generatedAt ? fetched : initial;

  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/runs/${runId}/studio-data`, { cache: "no-store" });
      if (!res.ok) return;
      setFetched(StudioDataSchema.parse(await res.json()));
    } finally {
      setIsRefreshing(false);
    }
  }, [runId]);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/events`);

    source.onopen = () => setLiveState("live");
    source.onerror = () => setLiveState("offline");

    source.addEventListener("status", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as {
        status: string;
        planHash: string | null;
        flagCount: number;
      };
      const current = dataRef.current;
      const isSame =
        next.status === current.run.status &&
        next.planHash === current.planHash &&
        next.flagCount === current.flags.length;
      if (!isSame) void refresh();
    });

    source.addEventListener("rationale.ready", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as { count: number };
      if (next.count !== dataRef.current.rationaleCount) void refresh();
    });

    return () => source.close();
  }, [runId, refresh]);

  useEffect(() => {
    if (data.run.status !== "APPLYING") return;
    const timer = setInterval(() => {
      void refreshReconciliation(runId).then(() => refresh());
    }, 5000);
    return () => clearInterval(timer);
  }, [data.run.status, runId, refresh]);

  return { data, refresh, isRefreshing, liveState };
}

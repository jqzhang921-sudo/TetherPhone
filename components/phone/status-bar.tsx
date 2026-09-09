"use client";
import { useEffect, useState } from "react";

/// 时间必须在挂载后才写进 DOM：服务端渲染出来的时刻和客户端不是同一秒，
/// 直接渲染会 hydration 报错。
export function StatusBar({ dim = false }: { dim?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const time = now
    ? `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`
    : "";

  return (
    <div
      className="flex items-center justify-between px-7 pt-3 pb-1 text-[15px] font-semibold select-none"
      style={{ color: dim ? "var(--ink-dim)" : "var(--ink)" }}
    >
      <span className="tabular-nums w-14">{time}</span>
      <span className="flex items-center gap-1.5 opacity-90">
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="4.5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="9" y="3" width="3" height="9" rx="1" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 11.2 5.9 8.9a3 3 0 0 1 4.2 0zM8 6.4c-1.4 0-2.7.5-3.7 1.4L2.9 6.4A7.5 7.5 0 0 1 8 4.4c1.9 0 3.7.7 5.1 2l-1.4 1.4A5.4 5.4 0 0 0 8 6.4M8 2.4c-2.5 0-4.8.9-6.5 2.5L0 3.4A11.4 11.4 0 0 1 8 .4c3 0 5.8 1.1 8 3l-1.5 1.5A9.4 9.4 0 0 0 8 2.4" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.2"
            stroke="currentColor" strokeOpacity="0.45" />
          <rect x="2.2" y="2.2" width="15" height="7.6" rx="1.9" fill="currentColor" />
          <path d="M23.4 4.2v3.6a2 2 0 0 0 0-3.6" fill="currentColor" fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

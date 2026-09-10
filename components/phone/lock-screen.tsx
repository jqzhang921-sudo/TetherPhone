"use client";
import { useEffect, useRef, useState } from "react";
import { StatusBar } from "./status-bar";

/// 锁屏。上滑解锁，桌面上点一下也行——鼠标用户没有"上滑"这个动作，
/// 只留手势等于把一半人锁在外面。
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [now, setNow] = useState<Date | null>(null);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";
  const date = now
    ? `${now.getMonth() + 1}月${now.getDate()}日 星期${"日一二三四五六"[now.getDay()]}`
    : "";

  const end = () => {
    if (dy < -90) onUnlock();
    else setDy(0);
    start.current = null;
  };

  return (
    <div
      className="absolute inset-0 flex flex-col anim-fade"
      style={{
        transform: `translateY(${dy}px)`,
        opacity: 1 + dy / 400,
        transition: start.current === null ? "transform 320ms var(--ease-ios), opacity 320ms" : "none",
        touchAction: "none",
      }}
      onPointerDown={(e) => { start.current = e.clientY; }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        setDy(Math.min(0, e.clientY - start.current));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={() => { if (dy === 0) onUnlock(); }}
    >
      <StatusBar />
      <div className="flex-1 flex flex-col items-center pt-16 select-none">
        <div
          className="text-[13px] tracking-[0.2em] mb-1"
          style={{ color: "var(--ink-dim)" }}
        >
          {date}
        </div>
        <div
          className="text-[86px] leading-none font-light tabular-nums"
          style={{ color: "var(--ink)", textShadow: "0 2px 24px oklch(0 0 0 / 0.3)" }}
        >
          {hh}:{mm}
        </div>
      </div>
      <div
        className="flex flex-col items-center gap-3 select-none"
        style={{ paddingBottom: "calc(2rem + var(--sab))" }}
      >
        <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
          上滑解锁
        </span>
        <span
          className="w-[134px] h-[5px] rounded-full"
          style={{ background: "var(--ink)", opacity: 0.45 }}
        />
      </div>
    </div>
  );
}

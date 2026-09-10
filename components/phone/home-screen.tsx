"use client";
import { useEffect, useState } from "react";
import { StatusBar } from "./status-bar";
import { AppIcon } from "./app-icon";
import { dockApps, gridApps } from "@/lib/apps/registry";

type Open = (id: string, center: { x: number; y: number }) => void;

function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="glass rounded-3xl h-[104px]" />;

  const date = `${now.getMonth() + 1}月${now.getDate()}日 星期${"日一二三四五六"[now.getDay()]}`;
  return (
    <div className="glass rounded-3xl px-5 py-4 flex items-center justify-between">
      <div>
        <div
          className="text-[34px] leading-none font-light tabular-nums"
          style={{ color: "var(--ink)" }}
        >
          {String(now.getHours()).padStart(2, "0")}:
          {String(now.getMinutes()).padStart(2, "0")}
        </div>
        <div className="text-[12px] mt-1.5" style={{ color: "var(--ink-dim)" }}>
          {date}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
          这台手机
        </div>
        <div className="text-[12px] mt-1" style={{ color: "var(--ink-dim)" }}>
          还很新
        </div>
      </div>
    </div>
  );
}

export function HomeScreen({
  onOpen,
  badges = {},
}: {
  onOpen: Open;
  badges?: Record<string, number>;
}) {
  return (
    <div className="absolute inset-0 flex flex-col anim-fade">
      <StatusBar />
      <div className="px-5 pt-3">
        <ClockWidget />
      </div>

      <div className="flex-1 px-5 pt-6 overflow-y-auto no-bar">
        <div className="grid grid-cols-4 gap-x-4 gap-y-5">
          {gridApps.map((a) => (
            <AppIcon key={a.id} app={a} onOpen={onOpen} badge={badges[a.id] ?? 0} />
          ))}
        </div>
      </div>

      <div className="flex justify-center gap-1.5 pb-3">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ink)", opacity: 0.8 }} />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ink)", opacity: 0.3 }} />
      </div>

      <div className="px-4 pb-3">
        <div className="glass rounded-[30px] px-3 py-3">
          <div className="grid grid-cols-4 gap-3">
            {dockApps.map((a) => (
              <AppIcon key={a.id} app={a} onOpen={onOpen} showLabel={false} badge={badges[a.id] ?? 0} />
            ))}
          </div>
        </div>
      </div>

      <div
        className="flex justify-center"
        style={{ paddingBottom: "calc(0.5rem + var(--sab))" }}
      >
        <span
          className="w-[134px] h-[5px] rounded-full"
          style={{ background: "var(--ink)", opacity: 0.35 }}
        />
      </div>
    </div>
  );
}

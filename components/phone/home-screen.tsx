"use client";
import { useEffect, useState } from "react";
import { StatusBar } from "./status-bar";
import { AppIcon } from "./app-icon";
import { dockApps, gridApps } from "@/lib/apps/registry";
import { usePlayer } from "./player";

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
  const p = usePlayer();
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

      {/* 在放什么。**没在放就不出现**——空的播放条比没有更碍事。
          点一下进音乐 app，和真手机上从锁屏点进播放器是一个意思。 */}
      {p.track && (
        <div className="px-4 pb-2">
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onOpen("music", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
            className="glass w-full rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 text-left active:opacity-70"
          >
            {/* ⚠️ 左边原来还有一个同样的播放/暂停图标当「状态指示」。去掉了：
                左右两个长得一模一样的符号，一个是状态一个是按钮，
                人分不出哪个能点。状态由右边那个按钮本身表达就够了。 */}
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] truncate" style={{ color: "var(--ink)" }}>
                {p.track.title}
              </span>
              {!!p.track.artist && (
                <span className="block text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
                  {p.track.artist}
                </span>
              )}
            </span>
            <span
              onClick={(e) => {
                // 别让点播放键顺带把 app 也打开了
                e.stopPropagation();
                p.toggle();
              }}
              className="shrink-0 p-1.5 -m-1.5"
              style={{ color: "var(--ink)" }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                {p.playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5l12 7-12 7z" />}
              </svg>
            </span>
          </button>
        </div>
      )}

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

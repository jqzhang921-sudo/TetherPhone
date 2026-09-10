"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StatusBar } from "./status-bar";
import type { AppDef } from "@/lib/apps/registry";

/// 从图标位置"长出来"的窗口。
///
/// 刻意没做等比例拉伸（把图标矩形补间到全屏那种）——非等比缩放会把里面的
/// 字挤扁，一眼假。改成以图标中心为原点做等比放大 + 淡入，观感对，
/// 而且不用管内容布局。
export function AppWindow({
  app,
  origin,
  closing,
  onClose,
  children,
}: {
  app: AppDef;
  origin: { x: number; y: number };
  closing: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [entered, setEntered] = useState(false);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    // 下一帧再切到终态，否则起始态和终态在同一帧里，浏览器不会过渡。
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const shrunk = !entered || closing;

  const endDrag = () => {
    if (dy < -70) onClose();
    else setDy(0);
    start.current = null;
  };

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{
        transformOrigin: `${origin.x}px ${origin.y}px`,
        transform: shrunk
          ? `scale(0.16) translateY(${dy * 0.3}px)`
          : `scale(1) translateY(${dy * 0.3}px)`,
        opacity: shrunk ? 0 : 1,
        borderRadius: shrunk ? 17 : 0,
        transition: start.current === null
          ? "transform var(--dur-app) var(--ease-ios), opacity 260ms var(--ease-ios), border-radius var(--dur-app) var(--ease-ios)"
          : "none",
        // 满屏的 app 自己画背景；不画的话窗口这层毛玻璃会盖住它。
        background: app.bleed
          ? "transparent"
          : "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
        backdropFilter: app.bleed ? "none" : "blur(28px) saturate(1.5)",
        WebkitBackdropFilter: app.bleed ? "none" : "blur(28px) saturate(1.5)",
      }}
    >
      {/* 满屏时内容垫在最底下，状态栏和 home 条浮在它上面 */}
      {app.bleed && <div className="absolute inset-0">{children}</div>}

      <div className={app.bleed ? "relative z-10" : "contents"}>
        <StatusBar />
      </div>
      {!app.ownHeader && (
        <header className="px-5 pt-1 pb-3 shrink-0">
          <h1 className="text-[26px] font-semibold" style={{ color: "var(--ink)" }}>
            {app.name}
          </h1>
        </header>
      )}

      {app.bleed ? (
        <div className="flex-1 min-h-0 pointer-events-none" />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      )}

      {/* home 条：上滑或点一下回桌面 */}
      <div
        className="shrink-0 pt-2 flex justify-center relative z-10"
        style={{ touchAction: "none", paddingBottom: "calc(0.5rem + var(--sab))" }}
        onPointerDown={(e) => { start.current = e.clientY; }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          setDy(Math.min(0, e.clientY - start.current));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => { if (dy === 0) onClose(); }}
      >
        <span
          className="w-[134px] h-[5px] rounded-full cursor-pointer"
          style={{ background: "var(--ink)", opacity: 0.35 }}
        />
      </div>
    </div>
  );
}

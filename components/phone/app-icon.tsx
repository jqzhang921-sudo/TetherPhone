"use client";
import type { AppDef } from "@/lib/apps/registry";

export function AppIcon({
  app,
  onOpen,
  showLabel = true,
}: {
  app: AppDef;
  onOpen: (id: string, center: { x: number; y: number }) => void;
  showLabel?: boolean;
}) {
  return (
    <button
      className="flex flex-col items-center gap-1.5 w-full active:scale-90 transition-transform duration-150"
      style={{ transitionTimingFunction: "var(--ease-ios)" }}
      onClick={(e) => {
        // 图标中心 = 新窗口"长出来"的原点。取的是屏幕坐标，
        // 换算成设备框内坐标交给上层——这里拿不到设备框的位置。
        const r = e.currentTarget.getBoundingClientRect();
        onOpen(app.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <span
        className="glass-icon grid place-items-center rounded-[17px] w-[58px] h-[58px]"
        style={{ color: app.tint }}
      >
        {app.icon}
      </span>
      {showLabel && (
        <span
          className="text-[11px] leading-tight truncate w-full text-center"
          style={{ color: "var(--ink)", textShadow: "0 1px 3px oklch(0 0 0 / 0.35)" }}
        >
          {app.name}
        </span>
      )}
    </button>
  );
}

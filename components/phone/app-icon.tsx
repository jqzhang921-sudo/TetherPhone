"use client";
import type { AppDef } from "@/lib/apps/registry";

export function AppIcon({
  app,
  onOpen,
  showLabel = true,
  badge = 0,
}: {
  app: AppDef;
  onOpen: (id: string, center: { x: number; y: number }) => void;
  showLabel?: boolean;
  /// 未处理的数量。0 就不画——空的红点比没有红点更烦人。
  badge?: number;
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
      <span className="relative">
        <span
          className="glass-icon grid place-items-center rounded-[17px] w-[58px] h-[58px]"
          style={{ color: app.tint }}
        >
          {app.icon}
        </span>
        {badge > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 rounded-full grid place-items-center text-[11px] font-medium tabular-nums"
            style={{ background: "oklch(0.62 0.21 25)", color: "oklch(0.99 0 0)" }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
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

"use client";
import { useState } from "react";
import { AppIcon } from "./app-icon";
import { appById } from "@/lib/apps/registry";
import { cleanName, type Folder } from "@/lib/os/folders";

/// 桌面上那个方块：一格大小，里面九宫格塞前几个 app 的图标。
///
/// ⚠️ **里面画的是真图标的缩小版，不是几个色块。** 九宫格的意义就是
/// 「不点开也认得出里面是什么」——画成抽象方块的话，它就只是个带名字的盒子，
/// 那还不如直接列出来。
export function FolderIcon({
  folder,
  badge,
  onOpen,
}: {
  folder: Folder;
  badge: number;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-center gap-1.5 w-full active:scale-90 transition-transform duration-150"
      style={{ transitionTimingFunction: "var(--ease-ios)" }}
    >
      <span className="relative">
        <span className="glass-icon rounded-[17px] w-[58px] h-[58px] grid grid-cols-3 gap-[3px] p-[5px]">
          {folder.apps.slice(0, 9).map((id) => {
            const a = appById(id);
            return (
              <span
                key={id}
                className="rounded-[4px] grid place-items-center overflow-hidden"
                style={{
                  background: "color-mix(in oklab, var(--glass-tint) 55%, transparent)",
                  color: a?.tint,
                }}
              >
                {/* 图标本身是 24 的 svg，缩到格子里 */}
                <span style={{ transform: "scale(0.58)", lineHeight: 0 }}>{a?.icon}</span>
              </span>
            );
          })}
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
      <span
        className="text-[11px] leading-tight truncate w-full text-center"
        style={{ color: "var(--ink)", textShadow: "0 1px 3px oklch(0 0 0 / 0.35)" }}
      >
        {folder.name}
      </span>
    </button>
  );
}

/// 点开之后那一层。名字可改，编辑态下每个 app 能拿出来。
export function FolderSheet({
  folder,
  badges,
  edit,
  onOpen,
  onRename,
  onTakeOut,
  onClose,
}: {
  folder: Folder;
  badges: Record<string, number>;
  edit: boolean;
  onOpen: (id: string, center: { x: number; y: number }) => void;
  onRename: (name: string) => void;
  onTakeOut: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder.name);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center px-5">
      <button
        aria-label="关掉"
        onClick={() => {
          onRename(name);
          onClose();
        }}
        className="absolute inset-0"
        style={{ background: "oklch(0 0 0 / 0.35)", backdropFilter: "blur(14px)" }}
      />
      <div className="glass-strong relative w-full rounded-[28px] px-4 pt-4 pb-5 anim-rise">
        <input
          value={name}
          onChange={(e) => setName(cleanName(e.target.value))}
          onBlur={() => onRename(name)}
          className="w-full bg-transparent text-center text-[15px] outline-none pb-3"
          style={{ color: "var(--ink)" }}
          aria-label="文件夹名字"
        />
        <div className="grid grid-cols-4 gap-x-4 gap-y-5">
          {folder.apps.map((id) => {
            const a = appById(id);
            if (!a) return null;
            return (
              <span key={id} className={`relative ${edit ? "anim-wiggle" : ""}`}>
                <AppIcon
                  app={a}
                  badge={badges[id] ?? 0}
                  onOpen={(appId, center) => {
                    onClose();
                    onOpen(appId, center);
                  }}
                />
                {edit && (
                  // 拿出去。**不做"从文件夹里往外拖"**——那要在两套网格之间
                  // 换算坐标，代价远大于它带来的好处。
                  <button
                    onClick={() => onTakeOut(id)}
                    aria-label={`把${a.name}拿出来`}
                    className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full grid place-items-center text-[12px]"
                    style={{ background: "oklch(0.25 0 0 / 0.8)", color: "oklch(0.98 0 0)" }}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

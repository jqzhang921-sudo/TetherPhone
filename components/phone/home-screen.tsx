"use client";
import { useRef, useState } from "react";
import { StatusBar } from "./status-bar";
import { AppIcon } from "./app-icon";
import { usePlayer } from "./player";
import { WIDGETS, Widget, type WidgetId } from "./widgets";
import { APPS, dockApps, appById } from "@/lib/apps/registry";
import type { Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";

type Open = (id: string, center: { x: number; y: number }) => void;

/// 逗号串 ↔ 数组。存进 settings 的是一串 id，不是 JSON——
/// settings 是扁平的字符串表，塞 JSON 进去读写两头都要 try/catch。
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function HomeScreen({
  onOpen,
  badges = {},
  settings,
  contacts,
  onChange,
}: {
  onOpen: Open;
  badges?: Record<string, number>;
  settings: Settings;
  contacts: Contact[];
  onChange: (p: Partial<Settings>) => void;
}) {
  const p = usePlayer();
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  /// 正在拖的那个图标，和它当前落在第几格
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const press = useRef<number | null>(null);

  const widgets = list(settings.widgets) as WidgetId[];
  // 桌面上的图标：settings 里存的顺序优先，registry 里新增的补在后面
  // ——加了新 app 不该因为老用户的顺序里没有它就消失。
  const saved = list(settings.appOrder);
  const gridIds = [
    ...saved.filter((id) => APPS.some((a) => a.id === id && !a.dock)),
    ...APPS.filter((a) => !a.dock && !saved.includes(a.id)).map((a) => a.id),
  ];

  const holdStart = () => {
    press.current = window.setTimeout(() => setEdit(true), 600);
  };
  const holdEnd = () => {
    if (press.current) window.clearTimeout(press.current);
    press.current = null;
  };

  /// 拖到哪一格。按指针落在网格里的位置反推，比逐个元素判断命中省事，
  /// 也不会因为图标在动而抖。
  const slotAt = (x: number, y: number) => {
    const g = gridRef.current;
    if (!g) return 0;
    const r = g.getBoundingClientRect();
    const col = Math.min(3, Math.max(0, Math.floor(((x - r.left) / r.width) * 4)));
    const rowH = 84;
    const row = Math.max(0, Math.floor((y - r.top) / rowH));
    return Math.min(gridIds.length - 1, row * 4 + col);
  };

  const commit = () => {
    if (!drag) return;
    const from = gridIds.indexOf(drag.id);
    if (from >= 0 && drag.to !== from) {
      const next = [...gridIds];
      next.splice(from, 1);
      next.splice(drag.to, 0, drag.id);
      onChange({ appOrder: next.join(",") });
    }
    setDrag(null);
  };

  const shown = drag
    ? (() => {
        const next = gridIds.filter((x) => x !== drag.id);
        next.splice(drag.to, 0, drag.id);
        return next;
      })()
    : gridIds;

  return (
    <div
      className="absolute inset-0 flex flex-col anim-fade"
      onPointerDown={edit ? undefined : holdStart}
      onPointerUp={holdEnd}
      onPointerCancel={holdEnd}
      onPointerMove={holdEnd}
    >
      <StatusBar />

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pt-2">
        {/* 组件。四列网格，宽的占四格、窄的占两格 */}
        {widgets.length > 0 && (
          <div className="grid grid-cols-4 gap-3 pb-4">
            {widgets.map((w) => (
              <div key={w} className={`relative ${edit ? "anim-wiggle" : ""} contents`}>
                <Widget id={w} settings={settings} contacts={contacts} onOpen={onOpen} />
              </div>
            ))}
          </div>
        )}

        {edit && (
          <div className="flex gap-2 pb-3">
            <button
              onClick={() => setAdding(true)}
              className="glass-strong flex-1 rounded-2xl py-2 text-[13px]"
              style={{ color: "var(--ink)" }}
            >
              加组件
            </button>
            <button
              onClick={() => {
                setEdit(false);
                setDrag(null);
              }}
              className="glass-strong flex-1 rounded-2xl py-2 text-[13px]"
              style={{ color: "var(--ink)" }}
            >
              完成
            </button>
          </div>
        )}

        {/* 图标 */}
        <div ref={gridRef} className="grid grid-cols-4 gap-x-4 gap-y-5 pb-4">
          {shown.map((id) => {
            const a = appById(id);
            if (!a) return null;
            const moving = drag?.id === id;
            return (
              <div
                key={id}
                className={edit ? "anim-wiggle" : ""}
                style={{
                  opacity: moving ? 0.55 : 1,
                  transition: "opacity 160ms",
                  touchAction: edit ? "none" : undefined,
                }}
                onPointerDown={(e) => {
                  if (!edit) return;
                  // ⚠️ **setPointerCapture 会抛。** 指针已经抬起、或者这个
                  // pointerId 不是活跃指针时，它扔 NotFoundError——不接住的话
                  // 整个 handler 在这儿断掉，setDrag 根本轮不到执行，
                  // 症状是「按住拖不动，也不报错」。
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // 抓不住就算了，下面照样能靠冒泡的 move 事件跟。
                  }
                  setDrag({ id, to: gridIds.indexOf(id) });
                }}
                onPointerMove={(e) => {
                  if (!edit || !drag) return;
                  setDrag({ id: drag.id, to: slotAt(e.clientX, e.clientY) });
                }}
                onPointerUp={commit}
                onPointerCancel={commit}
              >
                <AppIcon
                  app={a}
                  onOpen={edit ? () => {} : onOpen}
                  badge={badges[a.id] ?? 0}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center gap-1.5 pb-3">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ink)", opacity: 0.8 }} />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ink)", opacity: 0.3 }} />
      </div>

      {/* 在放什么。**没在放就不出现**——空的播放条比没有更碍事。 */}
      {p.track && (
        <div className="px-4 pb-2">
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onOpen("music", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
            className="glass w-full rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 text-left active:opacity-70"
          >
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
              className="shrink-0 p-1.5"
              style={{ color: "var(--ink)" }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                {p.playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5l12 7-12 7z" />}
              </svg>
            </span>
            {/* 关掉。**暂停不等于关掉**——一条永远杵在桌面上的播放条，
                没有出口就是个 bug。 */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                p.stop();
              }}
              className="shrink-0 p-1.5 -mr-1.5"
              style={{ color: "var(--ink-faint)" }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
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

      <div className="flex justify-center" style={{ paddingBottom: "calc(0.5rem + var(--sab))" }}>
        <span className="w-[134px] h-[5px] rounded-full" style={{ background: "var(--ink)", opacity: 0.35 }} />
      </div>

      {/* 加/去组件 */}
      {adding && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end">
          <button aria-label="关掉" onClick={() => setAdding(false)} className="absolute inset-0"
            style={{ background: "oklch(0 0 0 / 0.45)" }} />
          <div className="glass-strong relative rounded-t-[28px] px-5 pt-4 pb-6 flex flex-col gap-2">
            <p className="text-[12px] pb-1" style={{ color: "var(--ink-faint)" }}>
              桌面上放哪些卡片
            </p>
            {WIDGETS.map((w) => {
              const on = widgets.includes(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() =>
                    onChange({
                      widgets: (on ? widgets.filter((x) => x !== w.id) : [...widgets, w.id]).join(","),
                    })
                  }
                  className="flex items-center gap-3 py-2 text-left"
                >
                  <span
                    className="w-5 h-5 rounded-md grid place-items-center shrink-0"
                    style={{
                      border: "1.5px solid var(--ink-faint)",
                      background: on ? "var(--ink)" : "transparent",
                    }}
                  >
                    {on && (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
                        stroke="var(--glass-tint)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12.5l5.5 5.5L20 6.5" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px]" style={{ color: "var(--ink)" }}>
                      {w.name}
                    </span>
                    <span className="block text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      {w.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

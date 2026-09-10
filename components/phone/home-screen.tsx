"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "./status-bar";
import { AppIcon } from "./app-icon";
import { usePlayer } from "./player";
import { WIDGETS, Widget, widgetById, type WidgetId } from "./widgets";
import {
  COLS,
  ROWS,
  occupants,
  pageCount,
  parseLayout,
  place,
  serializeLayout,
  type Placed,
} from "@/lib/os/layout";
import { APPS, dockApps, appById } from "@/lib/apps/registry";
import type { Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { PhotoPicker } from "@/components/photos/photo-picker";

type Open = (id: string, center: { x: number; y: number }) => void;

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const GAP = 8;

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
  /// 正在给哪个组件挑东西。**只有编辑态才进得来**——
  /// 平时点卡片是进 app，那是它的主要用途。
  const [config, setConfig] = useState<WidgetId | null>(null);
  const [page, setPage] = useState(0);
  /// 正在拖的那个，和它现在落在哪
  const [drag, setDrag] = useState<{ id: string; to: { page: number; col: number; row: number } } | null>(null);
  const press = useRef<number | null>(null);
  const flipAt = useRef(0);

  /// 一个格子多大。**列宽定完行高跟着走**，这样 2×2 就是正方形。
  /// ⚠️ 量宽度要用 offsetWidth：app 打开动画起手是 scale(0.16)，
  /// getBoundingClientRect 返回的是变换后的尺寸。
  const [cell, setCell] = useState(84);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el?.offsetWidth) setCell((el.offsetWidth - GAP * (COLS - 1)) / COLS);
  }, []);

  const on = list(settings.widgets) as WidgetId[];
  const items = [
    ...APPS.filter((a) => !a.dock).map((a) => ({ id: a.id, w: 1, h: 1 })),
    ...on.map((id) => {
      const def = widgetById(id);
      return { id: `w:${id}`, w: def?.w ?? 2, h: def?.h ?? 2 };
    }),
  ];
  const placed = place(items, parseLayout(settings.layout));

  // 编辑时多留一页空的，好把东西拖过去
  const pages = pageCount(placed) + (edit ? 1 : 0);

  const holdStart = () => {
    press.current = window.setTimeout(() => setEdit(true), 600);
  };
  const holdEnd = () => {
    if (press.current) window.clearTimeout(press.current);
    press.current = null;
  };

  const gridRef = useRef<HTMLDivElement>(null);

  /// 指针落在哪一格。按网格里的相对位置反推，比逐个元素判命中省事，
  /// 也不会因为图标在动而抖。
  const cellAt = (x: number, y: number) => {
    const g = gridRef.current;
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const col = Math.floor((x - r.left) / (cell + GAP));
    const row = Math.floor((y - r.top) / (cell + GAP));
    return { col: Math.max(0, Math.min(COLS - 1, col)), row: Math.max(0, Math.min(ROWS - 1, row)) };
  };

  const commit = () => {
    if (!drag) {
      return;
    }
    const me = placed.find((i) => i.id === drag.id);
    if (!me) {
      setDrag(null);
      return;
    }
    const want = { ...drag.to, w: me.w, h: me.h };
    const others = placed.filter((i) => i.id !== me.id);
    const hit = occupants(others, want);

    let next: Placed[] | null = null;
    if (hit.length === 0) {
      next = others.concat({ ...me, ...drag.to });
    } else if (hit.length === 1 && hit[0].w === me.w && hit[0].h === me.h) {
      // 一样大就换位。**只换一样大的**——大小不同的换过去必然压到别人，
      // 那种"拖一下整屏重排"是最让人不敢下手的交互。
      const other = hit[0];
      next = others
        .filter((i) => i.id !== other.id)
        .concat({ ...me, ...drag.to }, { ...other, page: me.page, col: me.col, row: me.row });
    }
    // next 还是 null = 放不下，原地弹回，不动任何东西
    if (next) onChange({ layout: serializeLayout(next) });
    setDrag(null);
  };

  const shown = drag
    ? placed.map((i) => (i.id === drag.id ? { ...i, ...drag.to } : i))
    : placed;

  return (
    <div
      className="absolute inset-0 flex flex-col anim-fade"
      onPointerDown={edit ? undefined : holdStart}
      onPointerUp={holdEnd}
      onPointerCancel={holdEnd}
      onPointerMove={holdEnd}
    >
      <StatusBar />

      {/* ⚠️ **横向翻页，不是纵向滚动。** 东西多了往下堆，就永远不用决定
          什么该放第一屏——而那个决定正是桌面的全部意义。
          用 scroll-snap 而不是自己算位移：手指跟随、惯性、回弹都是浏览器的活儿。 */}
      <div
        className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden no-bar flex"
        style={{ scrollSnapType: edit ? "none" : "x mandatory", touchAction: edit ? "none" : "pan-x" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {Array.from({ length: pages }, (_, pi) => (
          <div
            key={pi}
            className="shrink-0 w-full h-full px-4 pt-2"
            style={{ scrollSnapAlign: "start" }}
          >
            <div
              ref={pi === 0 ? (el) => { measure(el); gridRef.current = el; } : undefined}
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gridAutoRows: `${cell}px`,
                gap: GAP,
              }}
            >
              {shown
                .filter((i) => i.page === pi)
                .map((i) => {
                  const moving = drag?.id === i.id;
                  const isWidget = i.id.startsWith("w:");
                  const app = isWidget ? null : appById(i.id);
                  if (!isWidget && !app) return null;
                  return (
                    <div
                      key={i.id}
                      className={edit ? "anim-wiggle" : ""}
                      style={{
                        gridColumn: `${i.col + 1} / span ${i.w}`,
                        gridRow: `${i.row + 1} / span ${i.h}`,
                        opacity: moving ? 0.5 : 1,
                        transition: moving ? "none" : "opacity 160ms",
                        touchAction: edit ? "none" : undefined,
                        display: "flex",
                        alignItems: i.h === 1 ? "center" : "stretch",
                      }}
                      onPointerDown={(e) => {
                        if (!edit) return;
                        // ⚠️ setPointerCapture 会抛（指针已抬起、或不是活跃指针时
                        // 扔 NotFoundError）。不接住的话整个 handler 在这儿断掉，
                        // setDrag 根本轮不到执行，症状是「按住拖不动，也不报错」。
                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch {
                          /* 抓不住就算了，靠冒泡的 move 事件照样能跟 */
                        }
                        setDrag({ id: i.id, to: { page: i.page, col: i.col, row: i.row } });
                      }}
                      onPointerMove={(e) => {
                        if (!edit || !drag) return;
                        const box = gridRef.current?.getBoundingClientRect();
                        // 拖到屏幕边上就翻页。**要有冷却**，否则贴着边一帧翻一页。
                        if (box && Date.now() - flipAt.current > 700) {
                          const near = 26;
                          if (e.clientX < box.left + near && drag.to.page > 0) {
                            flipAt.current = Date.now();
                            setDrag({ ...drag, to: { ...drag.to, page: drag.to.page - 1 } });
                            return;
                          }
                          if (e.clientX > box.right - near && drag.to.page < pages - 1) {
                            flipAt.current = Date.now();
                            setDrag({ ...drag, to: { ...drag.to, page: drag.to.page + 1 } });
                            return;
                          }
                        }
                        const c = cellAt(e.clientX, e.clientY);
                        if (c) setDrag({ ...drag, to: { ...drag.to, ...c } });
                      }}
                      onPointerUp={commit}
                      onPointerCancel={commit}
                    >
                      {isWidget ? (
                        <span className="w-full h-full relative">
                          <Widget
                            id={i.id.slice(2) as WidgetId}
                            settings={settings}
                            contacts={contacts}
                            onOpen={onOpen}
                          />
                          {/* 编辑态下盖一层：点它是「挑内容」，不是进 app。
                              没得挑的组件不盖，免得点了没反应。 */}
                          {edit && widgetById(i.id.slice(2))?.options && (
                            <button
                              onClick={() => setConfig(i.id.slice(2) as WidgetId)}
                              className="absolute inset-0 rounded-[26px] grid place-items-center text-[12px]"
                              style={{ background: "oklch(0.15 0 0 / 0.35)", color: "oklch(0.99 0 0)" }}
                            >
                              挑照片
                            </button>
                          )}
                        </span>
                      ) : (
                        <AppIcon app={app!} onOpen={edit ? () => {} : onOpen} badge={badges[app!.id] ?? 0} />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <div className="flex gap-2 px-4 pb-2">
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

      <div className="flex justify-center gap-1.5 pb-3">
        {Array.from({ length: pages }, (_, i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--ink)", opacity: i === page ? 0.8 : 0.3 }}
          />
        ))}
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

      {/* 相册卡放哪几张 */}
      {config === "photos" && (
        <PhotoPicker
          contactId={
            contacts.find((c) => c.id === settings.togetherWith)?.id ?? contacts[0]?.id ?? ""
          }
          picked={list(settings.photoWidget)}
          doneLabel={(n) => (n ? `放 ${n} 张上去` : "用最近的几张")}
          onDone={(ids) => onChange({ photoWidget: ids.join(",") })}
          onClose={() => setConfig(null)}
        />
      )}

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
              const has = on.includes(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() =>
                    onChange({
                      widgets: (has ? on.filter((x) => x !== w.id) : [...on, w.id]).join(","),
                    })
                  }
                  className="flex items-center gap-3 py-2 text-left"
                >
                  <span
                    className="w-5 h-5 rounded-md grid place-items-center shrink-0"
                    style={{
                      border: "1.5px solid var(--ink-faint)",
                      background: has ? "var(--ink)" : "transparent",
                    }}
                  >
                    {has && (
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

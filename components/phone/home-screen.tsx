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
import { Edge } from "./refraction";
import {
  FOLDER_PREFIX,
  cleanName,
  folderKey,
  isFolder,
  parseFolders,
  serializeFolders,
} from "@/lib/os/folders";
import { FolderIcon, FolderSheet } from "./folder";

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
  /// 点开了哪个文件夹
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  /// 正在拖的那个，和它现在落在哪
  const [drag, setDrag] = useState<{ id: string; to: { page: number; col: number; row: number } } | null>(null);

  /// ⚠️ **编辑态下按在一个东西上 = 立刻拿起来，不等。**
  ///
  /// 上一版想同时支持「按住不动才拖、马上滑走算翻页」，用 260ms 定性。
  /// 实测这条不成立：**正常人拖东西不会先停一下**——按下 90ms 就开始动，
  /// 于是每次都被判成翻页，组件永远拿不起来，症状正是「拖不进去」。
  ///
  /// 现在的分工是：**压在东西上 = 拖它，压在空处 = 翻页**（空处走原生滚动）。
  /// 拖的时候手滑到屏幕边上那一条，页跟着翻——这样「摁住它滑到别的屏」
  /// 是一个连续动作，不用先松手。
  const g = useRef<{ id: string; scroll: number } | null>(null);

  /// 还没进编辑态时，按在某个东西上的那一次长按。手一动就作废（那是在翻页）。
  const grab = useRef<{ x: number; y: number; timer: number } | null>(null);
  const dropGrab = () => {
    if (grab.current) window.clearTimeout(grab.current.timer);
    grab.current = null;
  };
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
  const folders = parseFolders(settings.folders);
  /// 收进文件夹的 app 不再单独出现在桌面上。**一个 app 只能在一处**——
  /// 两处都画的话，拖走一处另一处还在，那个"删不掉的影子"很难解释。
  const inFolder = new Set(folders.flatMap((f) => f.apps));
  const items = [
    ...APPS.filter((a) => !a.dock && !inFolder.has(a.id)).map((a) => ({ id: a.id, w: 1, h: 1 })),
    ...folders.map((f) => ({ id: FOLDER_PREFIX + f.key, w: 1, h: 1 })),
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

  /// ⚠️ **每一页的网格都要留个引用。** 原来只留了第一页的，滚到第二页之后
  /// 拿它算格子，坐标整整差一屏——症状是「拖过去之后落点乱跳」。
  const grids = useRef(new Map<number, HTMLDivElement>());

  /// 指针落在哪一格。按网格里的相对位置反推，比逐个元素判命中省事，
  /// 也不会因为图标在动而抖。
  /// ⚠️ **夹取范围要按被拖那个东西的大小算，不是按格子数。**
  /// 夹到 COLS-1 的话，2 格宽的组件落在最后一列就是 3+2=5 列，越界、
  /// 一律弹回——而往右拖正是要翻页的方向，所以症状是「组件拖不到别的屏」，
  /// 图标（1 格宽）却没事。这个错只在大件上显形，很容易漏。
  const cellAt = (x: number, y: number, page: number, w: number, h: number) => {
    const g = grids.current.get(page);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const col = Math.floor((x - r.left) / (cell + GAP));
    const row = Math.floor((y - r.top) / (cell + GAP));
    return {
      col: Math.max(0, Math.min(COLS - w, col)),
      row: Math.max(0, Math.min(ROWS - h, row)),
    };
  };

  const endGesture = () => {
    g.current = null;
    commit();
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

    // ⚠️ **拖到文件夹上 = 放进去，拖到别的东西上 = 换位。**
    // 两种结果各自对应一种目标，不用靠悬停时长去猜（见 lib/os/folders.ts）。
    if (hit.length === 1 && isFolder(hit[0].id) && !isFolder(me.id) && !me.id.startsWith("w:")) {
      const key = folderKey(hit[0].id);
      onChange({
        folders: serializeFolders(
          folders.map((f) => (f.key === key ? { ...f, apps: [...f.apps, me.id] } : f)),
        ),
      });
      setDrag(null);
      return;
    }

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

  /// ⚠️ **拖动时元素留在原地，只画一个落点。**
  /// 原来是把它挪到目标格再渲染，跨页时它就被搬进**另一页的 DOM**，
  /// React 当成新元素重新挂载，指针捕获跟着没了——症状正是
  /// 「拖不到第二屏」：手一过边界，拖拽就断了。
  const shown = placed;

  /// 拖动中要落在哪一格。翻页时顺便把那一页滚过来，否则东西飞去了看不见的地方。
  const pager = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drag || !pager.current) return;
    const el = pager.current;
    const want = drag.to.page * el.clientWidth;
    if (Math.abs(el.scrollLeft - want) > 4) el.scrollTo({ left: want, behavior: "smooth" });
  }, [drag]);

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
        ref={pager}
        className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden no-bar flex"
        // 编辑态也保留翻页：空白处靠原生滚动，压在东西上靠下面那套手势
        style={{ scrollSnapType: "x mandatory", touchAction: "pan-x" }}
        onScroll={(e) => {
          // ⚠️ 滚动事件一帧来一次。**页号没变就别写 state**——
          // 不然滑一次屏就是几十次整屏重渲染（每次还带着六层折射）。
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          setPage((p) => (p === n ? p : n));
        }}
      >
        {Array.from({ length: pages }, (_, pi) => (
          <div
            key={pi}
            className="shrink-0 w-full h-full px-4 pt-2"
            style={{ scrollSnapAlign: "start" }}
          >
            <div
              ref={(el) => {
                if (el) grids.current.set(pi, el);
                else grids.current.delete(pi);
                if (pi === 0) measure(el);
              }}
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gridAutoRows: `${cell}px`,
                gap: GAP,
              }}
            >
              {/* 落点。拖到哪儿就在哪儿亮一下——元素本身不动，
                  所以跨页也不会把它从 DOM 里搬走。 */}
              {drag &&
                drag.to.page === pi &&
                (() => {
                  const me = placed.find((i) => i.id === drag.id);
                  if (!me) return null;
                  // 放不下就变红。⚠️ **松手才发现白拖一场是最气人的**——
                  // 落点能不能落，手还没松的时候就该看得出来。
                  const want = { ...drag.to, w: me.w, h: me.h };
                  const hit = occupants(
                    placed.filter((x) => x.id !== me.id),
                    want,
                  );
                  const ok =
                    hit.length === 0 ||
                    (hit.length === 1 && hit[0].w === me.w && hit[0].h === me.h) ||
                    (hit.length === 1 && isFolder(hit[0].id) && me.w === 1 && me.h === 1);
                  return (
                    <div
                      className="rounded-[22px] pointer-events-none"
                      style={{
                        gridColumn: `${drag.to.col + 1} / span ${me.w}`,
                        gridRow: `${drag.to.row + 1} / span ${me.h}`,
                        background: ok
                          ? "color-mix(in oklab, var(--ink) 12%, transparent)"
                          : "oklch(0.62 0.21 25 / 0.18)",
                        outline: `2px dashed ${ok ? "var(--ink-faint)" : "oklch(0.62 0.21 25)"}`,
                        outlineOffset: -2,
                      }}
                    />
                  );
                })()}
              {shown
                .filter((i) => i.page === pi)
                .map((i) => {
                  const moving = drag?.id === i.id;
                  const isWidget = i.id.startsWith("w:");
                  const folder = isFolder(i.id)
                    ? folders.find((f) => f.key === folderKey(i.id))
                    : undefined;
                  const app = isWidget || folder ? null : appById(i.id);
                  if (!isWidget && !folder && !app) return null;
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
                        // ⚠️ **长按进编辑态之后，手不松就要能直接拖走。**
                        // 原来这里是 `if (!edit) return`——长按时 edit 还是 false，
                        // 这一下就被丢掉了；600ms 后图标开始抖，可那次按压已经作废，
                        // 必须松手再按第二次才拖得动。而真人的动作是一气呵成的：
                        // 长按 → 开始抖 → 手不松直接拖。症状就是「怎么都拖不起来」。
                        //
                        // 这也是我三轮都没查到的原因：**我每次测试都是先进编辑态、
                        // 松手、再重新按下去拖**，恰好绕开了这条路径。
                        if (!edit) {
                          const el = e.currentTarget;
                          const pid = e.pointerId;
                          const sx = e.clientX;
                          const sy = e.clientY;
                          grab.current = {
                            x: sx,
                            y: sy,
                            timer: window.setTimeout(() => {
                              grab.current = null;
                              setEdit(true);
                              try {
                                el.setPointerCapture(pid);
                              } catch {
                                /* 抓不住就算了 */
                              }
                              const pg = pager.current;
                              g.current = { id: i.id, scroll: pg ? pg.scrollLeft : 0 };
                              setDrag({ id: i.id, to: { page: i.page, col: i.col, row: i.row } });
                            }, 600),
                          };
                          return;
                        }
                        // ⚠️ setPointerCapture 会抛（指针已抬起、或不是活跃指针时
                        // 扔 NotFoundError）。不接住的话整个 handler 在这儿断掉，
                        // 症状是「按住拖不动，也不报错」。
                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch {
                          /* 抓不住就算了，靠冒泡的 move 事件照样能跟 */
                        }
                        const el = pager.current;
                        g.current = { id: i.id, scroll: el ? el.scrollLeft : 0 };
                        setDrag({ id: i.id, to: { page: i.page, col: i.col, row: i.row } });
                      }}
                      onPointerMove={(e) => {
                        // 长按还没到点就动了 = 在翻页，不是要拖
                        if (grab.current) {
                          const gr = grab.current;
                          if (Math.abs(e.clientX - gr.x) > 10 || Math.abs(e.clientY - gr.y) > 10) {
                            dropGrab();
                          }
                        }
                        if (!edit || !g.current || !drag) return;
                        // 判边界用**可视区**，不是用某一页的网格——页滚过去之后
                        // 那一页的 rect 已经不在屏幕上了
                        const box = pager.current?.getBoundingClientRect();
                        // 拖到屏幕边上就翻页。**要有冷却**，否则贴着边一帧翻一页。
                        if (box && Date.now() - flipAt.current > 650) {
                          // ⚠️ 这一条要够宽。26px 的时候手指得几乎戳到屏幕边，
                          // 实际操作里根本够不着——那才是「拖不到别的屏」的另一半原因。
                          const near = 72;
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
                        const c = cellAt(e.clientX, e.clientY, drag.to.page, i.w, i.h);
                        if (c) setDrag({ ...drag, to: { ...drag.to, ...c } });
                      }}
                      onPointerUp={() => {
                        dropGrab();
                        endGesture();
                      }}
                      onPointerCancel={() => {
                        dropGrab();
                        endGesture();
                      }}
                    >
                      {isWidget ? (
                        <span className="w-full h-full relative">
                          <Widget
                            id={i.id.slice(2) as WidgetId}
                            settings={settings}
                            contacts={contacts}
                            onOpen={onOpen}
                          />
                          {/* ⚠️ **编辑态下一定要盖一层。** 不盖的话点卡片会进 app——
                              整理桌面的时候每碰一下就跳进一个应用，没法整理。
                              有东西可挑的（相册）顺便当入口，没有的就是块透明挡板。
                              指针事件照样往上冒，所以不影响拖动。 */}
                          {edit && (
                            <button
                              onClick={() => {
                                const w = widgetById(i.id.slice(2));
                                if (w?.options) setConfig(i.id.slice(2) as WidgetId);
                              }}
                              className="absolute inset-0 rounded-[26px] grid place-items-center text-[12px]"
                              style={
                                widgetById(i.id.slice(2))?.options
                                  ? { background: "oklch(0.15 0 0 / 0.35)", color: "oklch(0.99 0 0)" }
                                  : undefined
                              }
                            >
                              {widgetById(i.id.slice(2))?.options ? "挑照片" : ""}
                            </button>
                          )}
                        </span>
                      ) : folder ? (
                        <FolderIcon
                          folder={folder}
                          badge={folder.apps.reduce((n, id) => n + (badges[id] ?? 0), 0)}
                          onOpen={() => !edit && setOpenFolder(folder.key)}
                        />
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
              // 空文件夹不会被存下来（serializeFolders 会滤掉），所以先塞一个
              // app 进去：桌面上第一个没归档的。没有可放的就不建。
              const first = APPS.find((a) => !a.dock && !inFolder.has(a.id));
              if (!first) return;
              onChange({
                folders: serializeFolders([
                  ...folders,
                  { key: String(Date.now().toString(36)), name: "文件夹", apps: [first.id] },
                ]),
              });
            }}
            className="glass-strong flex-1 rounded-2xl py-2 text-[13px]"
            style={{ color: "var(--ink)" }}
          >
            新文件夹
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
        <div className="glass rounded-[30px] px-3 py-3 relative">
          <Edge radius={30} />
          <div className="grid grid-cols-4 gap-3 relative">
            {dockApps.map((a) => (
              <AppIcon key={a.id} app={a} onOpen={onOpen} showLabel={false} badge={badges[a.id] ?? 0} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center" style={{ paddingBottom: "calc(0.5rem + var(--sab))" }}>
        <span className="w-[134px] h-[5px] rounded-full" style={{ background: "var(--ink)", opacity: 0.35 }} />
      </div>

      {/* 点开的文件夹 */}
      {openFolder && folders.some((f) => f.key === openFolder) && (
        <FolderSheet
          folder={folders.find((f) => f.key === openFolder)!}
          badges={badges}
          edit={edit}
          onOpen={onOpen}
          onRename={(name) =>
            onChange({
              folders: serializeFolders(
                folders.map((f) => (f.key === openFolder ? { ...f, name } : f)),
              ),
            })
          }
          onTakeOut={(id) => {
            const next = folders.map((f) =>
              f.key === openFolder ? { ...f, apps: f.apps.filter((x) => x !== id) } : f,
            );
            // 掏空了就没这个文件夹了，面板也跟着关
            if (!next.find((f) => f.key === openFolder)?.apps.length) setOpenFolder(null);
            onChange({ folders: serializeFolders(next) });
          }}
          onClose={() => setOpenFolder(null)}
        />
      )}

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

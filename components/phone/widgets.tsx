"use client";
import { useEffect, useState } from "react";
import { usePlayer } from "./player";
import { loadNotes, paperOf, type Note } from "@/lib/notes/store";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { textOf } from "@/lib/weather/wmo";
import { Glyph } from "@/components/weather/glyph";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "./avatar";
import { faceOf, useMe } from "@/lib/os/avatar";

export type WidgetId = "clock" | "weather" | "music" | "photos" | "notes";

export const WIDGETS: { id: WidgetId; name: string; hint: string }[] = [
  { id: "clock", name: "时钟", hint: "时间和日期" },
  { id: "weather", name: "天气", hint: "现在几度、什么天" },
  { id: "music", name: "一起听", hint: "两个人的头像和一起听过多少首" },
  { id: "photos", name: "相册", hint: "最近收进来的几张" },
  { id: "notes", name: "备忘录", hint: "板上还没做的几件事" },
];

type Props = {
  settings: Settings;
  contacts: Contact[];
  onOpen: (id: string, center: { x: number; y: number }) => void;
};

/// 卡片外壳。点一下进对应的 app——组件是入口，不是装饰。
///
/// 照着真手机上的组件做：**方的、名字挂在卡片外面、里面再套一层小块**。
/// Cleo 给的两张截图里每个组件都是这个结构——外面一个大圆角，
/// 里面是一两个自己也有圆角的小块，名字在下面、和图标的名字同一档。
///
/// ⚠️ **尺寸按格子走，不按内容走。** 小的就是 2 列见方（正好压住两个图标的位置），
/// 宽的是 4 列、扁一些。内容多少都不改外形——一排组件高矮不齐是最显脏的，
/// 而"内容驱动高度"迟早会不齐：天气拿到数据前后就差一行。
function Card({
  app,
  onOpen,
  label,
  wide = false,
  children,
}: {
  app: string;
  onOpen: Props["onOpen"];
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "col-span-4" : "col-span-2"}>
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onOpen(app, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }}
        className="glass rounded-[26px] w-full p-2.5 text-left flex flex-col active:scale-[0.97] transition-transform"
        style={{ aspectRatio: wide ? "2.35 / 1" : "1 / 1" }}
      >
        {children}
      </button>
      <span
        className="block text-[11px] leading-tight truncate text-center mt-1.5"
        style={{ color: "var(--ink)", textShadow: "0 1px 3px oklch(0 0 0 / 0.35)" }}
      >
        {label}
      </span>
    </div>
  );
}

/// 卡片里那层小块，靠它做出「里面还有东西」的层次。
///
/// ⚠️ **要往「字」的方向偏，不能往「底」的方向偏。**
/// 一开始写成再叠一层 glass-tint（更白），结果在浅色壁纸上整片糊成一块：
/// 卡片本身已经是近白的了（壁纸下限把它顶到 63%），再刷一层白等于没有这层。
/// 用 --ink 兑很低的透明度，浅色下它是浅灰、深色下它是浅白，
/// 两边都能和卡片拉开——差值是相对卡片的，不是绝对颜色。
///
/// 不用 `.glass`：卡片已经把背景糊过一次了，在它里面再叠一层 backdrop-filter
/// 看不出区别，只是白烧 GPU——一屏四五张卡就是十来层模糊。
function Inner({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-[16px] px-2.5 py-2 ${className}`}
      style={{ background: "color-mix(in oklab, var(--ink) 7%, transparent)", ...style }}
    >
      {children}
    </div>
  );
}

function Clock({ onOpen }: Props) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  // 占位也要占同样大的地方，否则时间一到位整排组件会跳一下
  if (!now) return <div className="col-span-2 glass rounded-[26px]" style={{ aspectRatio: "1 / 1" }} />;
  return (
    <Card app="settings" onOpen={onOpen} label="时钟">
      <Inner className="flex-1 flex items-center">
        {/* 一行。竖着摞两个数字读起来像两个数，不像一个时刻 */}
        <span className="text-[34px] leading-none font-light tabular-nums" style={{ color: "var(--ink)" }}>
          {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
        </span>
      </Inner>
      <Inner className="mt-1.5 shrink-0">
        <span className="text-[11px]" style={{ color: "var(--ink-dim)" }}>
          {now.getMonth() + 1}月{now.getDate()}日 星期{"日一二三四五六"[now.getDay()]}
        </span>
      </Inner>
    </Card>
  );
}

/// 天气缓存在模块里。桌面每次重渲染都去请求一次就太蠢了——
/// 天气十分钟内不会变，问那么勤只是烧别人的接口。
let wxCache: { at: number; data: unknown } | null = null;

function Weather({ settings, onOpen }: Props) {
  const [wx, setWx] = useState<{
    place: string;
    current: { temp: number; code: number; day: boolean };
  } | null>((wxCache?.data as never) ?? null);

  useEffect(() => {
    if (wxCache && Date.now() - wxCache.at < 10 * 60_000) return;
    const q = settings.weatherPlace.trim()
      ? `?q=${encodeURIComponent(settings.weatherPlace.trim())}`
      : "";
    void fetch(`/api/weather${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.current) return;
        wxCache = { at: Date.now(), data: j };
        setWx(j);
      })
      .catch(() => {});
  }, [settings.weatherPlace]);

  return (
    <Card app="weather" onOpen={onOpen} label="天气">
      {wx ? (
        <>
          <Inner className="flex-1 flex items-center justify-between">
            <span className="text-[32px] leading-none font-light tabular-nums" style={{ color: "var(--ink)" }}>
              {wx.current.temp}°
            </span>
            <span style={{ color: "var(--ink-dim)" }}>
              <Glyph code={wx.current.code} day={wx.current.day} size={30} />
            </span>
          </Inner>
          <Inner className="mt-1.5 shrink-0 flex items-baseline gap-1.5">
            <span className="text-[11px] shrink-0" style={{ color: "var(--ink-dim)" }}>
              {textOf(wx.current.code)}
            </span>
            <span className="text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
              {wx.place}
            </span>
          </Inner>
        </>
      ) : (
        <Inner className="flex-1 grid place-items-center">
          {/* 空状态这行是这张卡当下的正文，不是附注。玻璃那条下限保的是
              --ink 那一档，--ink-faint 压在亮壁纸上会读不清。 */}
          <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
            在看外面…
          </span>
        </Inner>
      )}
    </Card>
  );
}

/// 一起听。**正在放就是「正在一起听」，没在放就是「一起听过几首」**
/// ——同一张卡两种状态，不是两张卡。
function Music({ settings, contacts, onOpen }: Props) {
  const p = usePlayer();
  const me = useMe(settings);
  const c = contacts.find((x) => x.id === settings.togetherWith) ?? null;
  return (
    <Card app="music" onOpen={onOpen} label="一起听">
      <Inner className="flex-1 flex items-center justify-center">
        <span className="flex items-center -space-x-2.5">
          <Avatar face={me} size={38} ring />
          {c && <Avatar face={faceOf(c)} size={38} ring />}
        </span>
      </Inner>
      <Inner className="mt-1.5 shrink-0">
        {p.track ? (
          <>
            <span className="block text-[11px] truncate" style={{ color: "var(--ink)" }}>
              {p.track.title}
            </span>
            <span className="block text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
              {c ? (p.playing ? `正在和${displayName(c)}一起听` : "停着") : "自己听"}
            </span>
          </>
        ) : (
          <>
            <span className="block text-[11px] truncate" style={{ color: "var(--ink)" }}>
              {c ? `和${displayName(c)}` : "一起听"}
            </span>
            <span className="block text-[10px]" style={{ color: "var(--ink-faint)" }}>
              {c?.songs ? `听过 ${c.songs} 首` : "还没一起听过"}
            </span>
          </>
        )}
      </Inner>
    </Card>
  );
}

function Photos({ settings, contacts, onOpen }: Props) {
  const [rows, setRows] = useState<Photo[]>([]);
  useEffect(() => {
    const c = contacts.find((x) => x.id === settings.togetherWith) ?? contacts[0];
    if (!c) return;
    // 方卡装四张正好。多了每张都小得看不出是什么，那就不是相册是马赛克
    void loadPhotos(c.id).then((all) => setRows(all.filter((x) => x.saved).slice(0, 4)));
  }, [contacts, settings.togetherWith]);

  return (
    <Card app="photos" onOpen={onOpen} label="相册">
      <Inner className="flex-1 min-h-0" style={rows.length ? { padding: 6 } : undefined}>
        {rows.length ? (
          <div className="grid grid-cols-2 gap-1 h-full">
            {rows.map((r) => (
              <PhotoImg key={r.id} photo={r} className="w-full h-full rounded-[9px] object-cover" />
            ))}
          </div>
        ) : (
          <div className="h-full grid place-items-center">
            <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
              相册还空着
            </span>
          </div>
        )}
      </Inner>
    </Card>
  );
}

function Notes({ settings, contacts, onOpen }: Props) {
  const [rows, setRows] = useState<Note[]>([]);
  useEffect(() => {
    const c = contacts.find((x) => x.id === settings.togetherWith) ?? contacts[0];
    if (!c) return;
    void loadNotes(c.id).then((all) => setRows(all.filter((n) => !n.done).slice(0, 3)));
  }, [contacts, settings.togetherWith]);

  return (
    <Card app="notes" onOpen={onOpen} label="备忘录">
      {rows.length ? (
        <div className="flex-1 min-h-0 flex flex-col gap-1.5">
          {rows.map((n) => (
            // 一条一块，和倒数日那种组件一个路子：内容是几行小块，不是一段文字
            <Inner key={n.id} className="flex-1 min-h-0 flex items-center gap-2 py-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: paperOf(n.id) }} />
              <span className="text-[12px] truncate" style={{ color: "var(--ink)" }}>
                {n.text}
              </span>
            </Inner>
          ))}
        </div>
      ) : (
        <Inner className="flex-1 grid place-items-center">
          {/* 空状态这行是这张卡当下的正文，不是附注。玻璃那条下限保的是
              --ink 那一档，--ink-faint 压在亮壁纸上会读不清。 */}
          <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
            板上没有待办
          </span>
        </Inner>
      )}
    </Card>
  );
}

export function Widget({ id, ...rest }: { id: WidgetId } & Props) {
  if (id === "clock") return <Clock {...rest} />;
  if (id === "weather") return <Weather {...rest} />;
  if (id === "music") return <Music {...rest} />;
  if (id === "photos") return <Photos {...rest} />;
  if (id === "notes") return <Notes {...rest} />;
  return null;
}

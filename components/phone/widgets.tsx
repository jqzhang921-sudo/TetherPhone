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
import { Edge } from "./refraction";
import { faceOf, useMe } from "@/lib/os/avatar";

export type WidgetId = "clock" | "weather" | "music" | "photos" | "notes";

/// 占几格。桌面的格子是正方的，所以 2×2 就是正方形的卡。
export const WIDGETS: { id: WidgetId; name: string; hint: string; w: number; h: number; options?: boolean }[] = [
  { id: "clock", name: "时钟", hint: "时间和日期", w: 2, h: 2 },
  { id: "weather", name: "天气", hint: "现在几度、什么天", w: 2, h: 2 },
  { id: "music", name: "一起听", hint: "两个人的头像和一起听过多少首", w: 2, h: 2 },
  { id: "photos", name: "相册", hint: "挑几张轮着放", w: 2, h: 2, options: true },
  { id: "notes", name: "备忘录", hint: "板上还没做的几件事", w: 2, h: 2 },
];

export const widgetById = (id: string) => WIDGETS.find((w) => w.id === id);

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
/// ⚠️ **尺寸由格子定，不由内容定。** 卡片撑满分给它的那块地方，
/// 内容多少都不改外形——一排组件高矮不齐是最显脏的，而"内容驱动高度"
/// 迟早会不齐：天气拿到数据前后就差一行。
function Card({
  app,
  onOpen,
  label,
  children,
}: {
  app: string;
  onOpen: Props["onOpen"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full h-full flex flex-col">
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onOpen(app, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }}
        className="glass rounded-[26px] w-full flex-1 min-h-0 p-2.5 text-left flex flex-col active:scale-[0.97] transition-transform relative"
      >
        {/* 边上那一点折射。**放在最前面**：它是背景的一部分，
            后面的内容自然盖在它上面，不用操心 z-index。 */}
        <Edge radius={26} />
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
  if (!now) return <div className="w-full h-full glass rounded-[26px]" />;
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

/// 相册卡。**一次只放一张**，多张就轮着来。
///
/// 一张卡里塞四张缩略图，每张都小得看不出是什么——那不是相册是马赛克。
/// 一次一张才看得见内容，也才像"摆在桌上的一张照片"。
function Photos({ settings, contacts, onOpen }: Props) {
  const [rows, setRows] = useState<Photo[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const c = contacts.find((x) => x.id === settings.togetherWith) ?? contacts[0];
    if (!c) return;
    const picked = settings.photoWidget.split(",").map((x) => x.trim()).filter(Boolean);
    void loadPhotos(c.id).then((all) => {
      const saved = all.filter((x) => x.saved);
      // 挑过就按挑的来，**并且按她挑的顺序**；没挑过就用最近收进来的几张
      const use = picked.length
        ? picked.map((id) => saved.find((p) => p.id === id)).filter((p): p is Photo => !!p)
        : saved.slice(0, 6);
      setRows(use);
      setAt(0);
    });
  }, [contacts, settings.togetherWith, settings.photoWidget]);

  // 只有一张就别转。定时器空转不为难谁，但会让人以为它随时会变。
  useEffect(() => {
    if (rows.length < 2) return;
    const t = setInterval(() => setAt((i) => (i + 1) % rows.length), 8000);
    return () => clearInterval(t);
  }, [rows.length]);

  const cur = rows[at];
  return (
    <Card app="photos" onOpen={onOpen} label="相册">
      <Inner className="flex-1 min-h-0 relative overflow-hidden" style={{ padding: 0 }}>
        {cur ? (
          rows.map((r, i) => (
            // 全部铺着、靠透明度交替。**换的时候两张都在**，
            // 不然中间会闪一下底色，像卡住了。
            <PhotoImg
              key={r.id}
              photo={r}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: i === at ? 1 : 0, transition: "opacity 700ms ease" }}
            />
          ))
        ) : (
          <div className="h-full grid place-items-center">
            <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
              相册还空着
            </span>
          </div>
        )}
        {rows.length > 1 && (
          <span className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
            {rows.map((r, i) => (
              <span
                key={r.id}
                className="w-1 h-1 rounded-full"
                style={{ background: "oklch(1 0 0)", opacity: i === at ? 0.95 : 0.4 }}
              />
            ))}
          </span>
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

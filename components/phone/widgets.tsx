"use client";
import { useEffect, useState } from "react";
import { usePlayer } from "./player";
import { loadNotes, paperOf, type Note } from "@/lib/notes/store";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { loadMsgs } from "@/lib/chat/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { textOf } from "@/lib/weather/wmo";
import { Glyph } from "@/components/weather/glyph";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "./avatar";
import { Edge } from "./refraction";
import { faceOf, useMe } from "@/lib/os/avatar";

export type WidgetId = "clock" | "weather" | "music" | "days" | "photos" | "photosWide" | "notes";

/// 占几格。桌面的格子是正方的，所以 2×2 就是正方形的卡。
export const WIDGETS: { id: WidgetId; name: string; hint: string; w: number; h: number; options?: boolean }[] = [
  { id: "clock", name: "时钟", hint: "时间和日期", w: 2, h: 2 },
  { id: "weather", name: "天气", hint: "现在几度、什么天", w: 2, h: 2 },
  { id: "music", name: "一起听", hint: "两个人的头像和一起听过多少首", w: 2, h: 2 },
  { id: "days", name: "在一起", hint: "从说第一句话那天算起，第几天", w: 2, h: 2 },
  { id: "photos", name: "相册", hint: "挑几张轮着放", w: 2, h: 2, options: true },
  { id: "photosWide", name: "相册 · 宽", hint: "一张照片铺满整张卡，不留边", w: 4, h: 2, options: true },
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

/// 在一起第几天。
///
/// ⚠️ **从你们说第一句话那天算，不让人自己填日期。** 填出来的是一个愿望，
/// 算出来的才是真的——这个 App 里「在一起」指的一直是真的发生过的事。
///
/// 按日历天数、第一天算第 1 天：昨晚 11 点说了第一句，今天就是第 2 天。
/// 不按「满 24 小时才加一」——那样半夜聊了一句，第二天白天还显示第 1 天。
const dayStart = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
// round 不是 floor：夏令时那天只有 23 或 25 个小时，除出来不是整数
const dayNo = (first: number, now: number) =>
  Math.round((dayStart(now) - dayStart(first)) / 86_400_000) + 1;

function Days({ settings, contacts, onOpen }: Props) {
  const me = useMe(settings);
  const c = contacts.find((x) => x.id === settings.togetherWith) ?? contacts[0] ?? null;
  /// undefined = 还在读；null = 一句话都还没说过
  const [first, setFirst] = useState<number | null | undefined>(undefined);
  /// 0 = 还没挂载。**不在渲染时直接读 Date.now()**：服务端和浏览器渲染出来的数不一样，会水合报错
  const [now, setNow] = useState(0);
  const cid = c?.id;

  useEffect(() => {
    if (!cid) return;
    let alive = true;
    void loadMsgs(cid).then((rows) => {
      // 事件（公开日记、拍一拍那些居中的小字）不算「说了话」
      const said = rows.filter((m) => m.role !== "event");
      if (alive) setFirst(said.length ? Math.min(...said.map((m) => m.at)) : null);
    });
    return () => {
      alive = false;
    };
  }, [cid]);

  // 过了零点要自己翻到下一天。一分钟看一眼，**只有日期真变了才换值**，平时不重渲染
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => {
      setNow((prev) => (dayStart(prev) === dayStart(Date.now()) ? prev : Date.now()));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const since = first ? new Date(first) : null;

  return (
    <Card app="chat" onOpen={onOpen} label="在一起">
      <Inner className="flex-1 flex items-center">
        {first === undefined || !now ? null : first === null ? (
          <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
            还没说过话
          </span>
        ) : (
          <span className="flex items-baseline gap-1" style={{ color: "var(--ink)" }}>
            <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
              第
            </span>
            <span className="text-[34px] leading-none font-light tabular-nums">{dayNo(first, now)}</span>
            <span className="text-[12px]" style={{ color: "var(--ink-dim)" }}>
              天
            </span>
          </span>
        )}
      </Inner>
      <Inner className="mt-1.5 shrink-0 flex items-center gap-1.5">
        <span className="flex items-center -space-x-1.5 shrink-0">
          <Avatar face={me} size={18} ring />
          {c && <Avatar face={faceOf(c)} size={18} ring />}
        </span>
        <span className="text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
          {since
            ? `${since.getMonth() + 1}月${since.getDate()}日说的第一句`
            : c
              ? `和${displayName(c)}`
              : ""}
        </span>
      </Inner>
    </Card>
  );
}

/// 照片卡：**不要玻璃边**。
///
/// 照片本身就是内容，也是底——外面再套一圈磨砂，就是相框里又镶了个相框，
/// 照片被挤小一圈，还显得隔着一层。所以这张卡不走 Card：照片直接铺满圆角，
/// 名字照旧挂在卡片外面，和别的组件一个节奏。
/// 只有空着的时候才用玻璃，免得桌面上出现一个透明的洞。
function BleedCard({
  app,
  onOpen,
  label,
  empty,
  children,
}: {
  app: string;
  onOpen: Props["onOpen"];
  label: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full h-full flex flex-col">
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onOpen(app, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }}
        className={`${empty ? "glass" : ""} rounded-[26px] w-full flex-1 min-h-0 relative overflow-hidden active:scale-[0.97] transition-transform`}
        style={
          empty
            ? undefined
            : {
                boxShadow: "0 8px 22px oklch(0 0 0 / 0.2)",
                // ⚠️ Safari 在按下缩放（transform）的那一下，overflow-hidden 会暂时不按圆角裁，
                // 照片的直角会从圆角里戳出来一下。蒙一层遮罩逼它照样按圆角裁。
                WebkitMaskImage: "-webkit-radial-gradient(white, black)",
              }
        }
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

/// 相册卡。**一次只放一张**，多张就轮着来。
///
/// 一张卡里塞四张缩略图，每张都小得看不出是什么——那不是相册是马赛克。
/// 一次一张才看得见内容，也才像"摆在桌上的一张照片"。
/// 方的和宽的是同一个组件，挑的照片分开存（settings.photoWidget / photoWideWidget）。
function PhotoFrame({
  settings,
  contacts,
  onOpen,
  pick,
  label,
}: Props & { pick: string; label: string }) {
  const [rows, setRows] = useState<Photo[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const c = contacts.find((x) => x.id === settings.togetherWith) ?? contacts[0];
    if (!c) return;
    const picked = pick.split(",").map((x) => x.trim()).filter(Boolean);
    void loadPhotos(c.id).then((all) => {
      const saved = all.filter((x) => x.saved);
      // 挑过就按挑的来，**并且按她挑的顺序**；没挑过就用最近收进来的几张
      const use = picked.length
        ? picked.map((id) => saved.find((p) => p.id === id)).filter((p): p is Photo => !!p)
        : saved.slice(0, 6);
      setRows(use);
      setAt(0);
    });
  }, [contacts, settings.togetherWith, pick]);

  // 只有一张就别转。定时器空转不为难谁，但会让人以为它随时会变。
  useEffect(() => {
    if (rows.length < 2) return;
    const t = setInterval(() => setAt((i) => (i + 1) % rows.length), 8000);
    return () => clearInterval(t);
  }, [rows.length]);

  return (
    <BleedCard app="photos" onOpen={onOpen} label={label} empty={!rows.length}>
      {rows.length ? (
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
        <span className="h-full grid place-items-center text-[12px]" style={{ color: "var(--ink-dim)" }}>
          相册还空着
        </span>
      )}
      {rows.length > 1 && (
        <span className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
          {rows.map((r, i) => (
            <span
              key={r.id}
              className="w-1 h-1 rounded-full"
              // 没有玻璃底托着了，白点直接压在照片上——亮照片上会看不见，垫一圈暗边
              style={{
                background: "oklch(1 0 0)",
                opacity: i === at ? 0.95 : 0.45,
                boxShadow: "0 0 2px oklch(0 0 0 / 0.45)",
              }}
            />
          ))}
        </span>
      )}
    </BleedCard>
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
  if (id === "days") return <Days {...rest} />;
  if (id === "photos") return <PhotoFrame {...rest} pick={rest.settings.photoWidget} label="相册" />;
  if (id === "photosWide")
    return <PhotoFrame {...rest} pick={rest.settings.photoWideWidget} label="相册 · 宽" />;
  if (id === "notes") return <Notes {...rest} />;
  return null;
}

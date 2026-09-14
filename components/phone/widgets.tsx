"use client";
import { useEffect, useId, useState } from "react";
import { usePlayer } from "./player";
import { loadNotes, paperOf, type Note } from "@/lib/notes/store";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { loadMsgs } from "@/lib/chat/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { sceneOf, skyCss, textOf, type Scene } from "@/lib/weather/wmo";
import { Glyph } from "@/components/weather/glyph";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "./avatar";
import { Edge } from "./refraction";
import { faceOf, useMe } from "@/lib/os/avatar";

export type WidgetId =
  | "clock"
  | "weather"
  | "weatherWide"
  | "sun"
  | "music"
  | "days"
  | "photos"
  | "photosWide"
  | "notes";

/// 占几格。桌面的格子是正方的，所以 2×2 就是正方形的卡。
export const WIDGETS: { id: WidgetId; name: string; hint: string; w: number; h: number; options?: boolean }[] = [
  { id: "clock", name: "时钟", hint: "时间和日期", w: 2, h: 2 },
  { id: "weather", name: "天气", hint: "现在几度、什么天，画成那片天", w: 2, h: 2 },
  { id: "weatherWide", name: "天气 · 几天", hint: "今天和往后四天", w: 4, h: 2 },
  { id: "sun", name: "日出日落", hint: "太阳走到哪儿了", w: 4, h: 2 },
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

/// 天气。**三张卡共用一份数据**：方的、几天的、日出日落。
///
/// 缓存在模块里——天气十分钟内不会变，桌面每次重渲染都去问一遍只是烧别人的接口。
/// ⚠️ **进行中的请求也要缓存。** 三张卡在同一帧挂载，只缓存结果的话，
/// 第一个请求回来之前三张卡各自都会发一个。
type Wx = {
  place: string;
  current: { temp: number; code: number; day: boolean };
  daily: { date: string; code: number; max: number; min: number; sunrise?: number; sunset?: number }[];
};
let wxCache: { at: number; key: string; data: Wx } | null = null;
let wxFlight: { key: string; p: Promise<Wx | null> } | null = null;

function useWeather(place: string): Wx | null {
  const key = place.trim();
  const [wx, setWx] = useState<Wx | null>(wxCache && wxCache.key === key ? wxCache.data : null);
  useEffect(() => {
    if (wxCache && wxCache.key === key && Date.now() - wxCache.at < 10 * 60_000) {
      setWx(wxCache.data);
      return;
    }
    let flight = wxFlight;
    if (!flight || flight.key !== key) {
      const q = key ? `?q=${encodeURIComponent(key)}` : "";
      const p: Promise<Wx | null> = fetch(`/api/weather${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.current) return null;
          wxCache = { at: Date.now(), key, data: j as Wx };
          return j as Wx;
        })
        .catch(() => null);
      const mine = { key, p };
      flight = mine;
      wxFlight = mine;
      void p.finally(() => {
        if (wxFlight === mine) wxFlight = null;
      });
    }
    let alive = true;
    void flight.p.then((d) => {
      if (alive && d) setWx(d);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return wx;
}

/// 压在天上的字用什么颜色。
///
/// ⚠️ **不能照搬 skyIsDark。** 那条只看白天黑夜，是因为天气 app 在雨天会多盖一层
/// 雾面玻璃把画面提亮；桌面这张小卡没有那层，雨天、雷雨的白天天空本来就偏暗，
/// 深色字压上去会糊。所以雨和雷雨的白天也用浅字，再垫一层很淡的暗（见 Sky）。
const lightInk = (scene: Scene, day: boolean) => !day || scene === "rain" || scene === "thunder";
const inkOn = (scene: Scene, day: boolean) =>
  lightInk(scene, day)
    ? { color: "oklch(0.98 0 0)", textShadow: "0 1px 3px oklch(0 0 0 / 0.35)" }
    : { color: "oklch(0.25 0.03 250)", textShadow: "none" };

/// 整张卡的底：那片天。和天气 app 用同一套渐变，桌面和点进去之后是同一片天。
function Sky({ scene, day }: { scene: Scene; day: boolean }) {
  return (
    <>
      <span className="absolute inset-0" style={{ background: skyCss(scene, day) }} />
      {day && (scene === "rain" || scene === "thunder") && (
        <span
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, oklch(0 0 0 / 0.2), oklch(0 0 0 / 0.06))" }}
        />
      )}
    </>
  );
}

/// 天气卡上的那幅小画。
///
/// ⚠️ **画出来，不是写出来。** 「26° 阴」谁都会写；一眼看过去是天气的，是那片天的颜色
/// 和天上挂着的东西。所以整张卡的底是天空渐变，角上挂一幅小画：太阳、月亮、云、雨丝、
/// 雪点、雾带，按场景拼。
/// 用填色的形状，不用线稿——线稿图标放大了还是图标，填了色才像画。
/// **不动**：桌面上好几张卡，每张都跑动画，手机就一直在耗电。
function SkyArt({ scene, day, size }: { scene: Scene; day: boolean; size: number }) {
  // 月牙靠遮罩挖出来。一屏可能有三张天气卡，遮罩的 id 必须各不相同，否则会互相借错
  const mask = `moon${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const cloud = (key: string, x: number, y: number, k: number, fill: string, op = 0.96) => (
    <g key={key} transform={`translate(${x} ${y}) scale(${k})`} fill={fill} opacity={op}>
      <circle cx="16" cy="20" r="9" />
      <circle cx="28" cy="14" r="12" />
      <circle cx="41" cy="21" r="8" />
      <rect x="7" y="19" width="42" height="11" rx="5.5" />
    </g>
  );
  const sun = (cx: number, cy: number, r: number) => (
    <g key="sun">
      <circle cx={cx} cy={cy} r={r * 2} fill="oklch(0.97 0.1 95)" opacity="0.32" />
      <circle cx={cx} cy={cy} r={r} fill="oklch(0.95 0.14 90)" />
    </g>
  );
  const moon = (cx: number, cy: number, r: number) => (
    <g key="moon">
      <mask id={mask}>
        <rect width="100" height="100" fill="white" />
        <circle cx={cx + r * 0.55} cy={cy - r * 0.35} r={r * 0.9} fill="black" />
      </mask>
      <circle cx={cx} cy={cy} r={r} fill="oklch(0.95 0.05 95)" mask={`url(#${mask})`} />
    </g>
  );
  const stars = (
    <g key="stars" fill="oklch(0.97 0.02 95)">
      <circle cx="22" cy="22" r="1.1" opacity="0.9" />
      <circle cx="38" cy="12" r="0.8" opacity="0.7" />
      <circle cx="30" cy="48" r="0.9" opacity="0.6" />
      <circle cx="88" cy="62" r="0.8" opacity="0.7" />
    </g>
  );
  const drops = (color: string, n: number, x0: number) => (
    <g key="drops" stroke={color} strokeWidth="2" strokeLinecap="round">
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + i * 9;
        const y = 62 + (i % 2) * 7;
        return <line key={i} x1={x} y1={y} x2={x - 3.5} y2={y + 10} />;
      })}
    </g>
  );
  const flakes = (
    <g key="flakes" fill="oklch(0.99 0 0)">
      {[[30, 66], [42, 74], [54, 64], [66, 74], [78, 66]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.2" />
      ))}
    </g>
  );

  let parts: React.ReactNode[] = [];
  if (scene === "clear") parts = day ? [sun(62, 38, 15)] : [stars, moon(62, 36, 14)];
  else if (scene === "cloudy")
    parts = [day ? sun(68, 30, 12) : moon(68, 28, 11), cloud("c", 14, 34, 1.25, "oklch(0.99 0 0)")];
  else if (scene === "overcast")
    parts = [
      cloud("c1", 30, 18, 1.1, "oklch(0.9 0.012 250)", 0.9),
      cloud("c2", 8, 38, 1.3, "oklch(0.97 0.006 250)"),
    ];
  else if (scene === "fog")
    parts = [0, 1, 2].map((i) => (
      <rect
        key={`f${i}`}
        x={14 + i * 6}
        y={34 + i * 13}
        width={66 - i * 8}
        height="6"
        rx="3"
        fill="oklch(0.99 0 0)"
        opacity={0.7 - i * 0.15}
      />
    ));
  else if (scene === "rain")
    parts = [cloud("c", 14, 22, 1.3, "oklch(0.93 0.01 250)"), drops("oklch(0.92 0.04 235)", 5, 30)];
  else if (scene === "thunder")
    parts = [
      cloud("c", 14, 20, 1.3, "oklch(0.78 0.02 260)"),
      <path key="bolt" d="M52 56 L42 72 H51 L45 88 L62 66 H53 L58 56 Z" fill="oklch(0.9 0.16 95)" />,
      drops("oklch(0.9 0.03 235)", 3, 30),
    ];
  else if (scene === "snow") parts = [cloud("c", 14, 22, 1.3, "oklch(0.97 0.006 250)"), flakes];

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      {parts}
    </svg>
  );
}

const shortPlace = (p: string) => p.split(" · ")[0];

function Weather({ settings, onOpen }: Props) {
  const wx = useWeather(settings.weatherPlace);
  const scene = wx ? sceneOf(wx.current.code) : "cloudy";
  const day = wx?.current.day ?? true;
  const today = wx?.daily?.[0];
  return (
    <BleedCard app="weather" onOpen={onOpen} label="天气" empty={!wx}>
      {wx ? (
        <>
          <Sky scene={scene} day={day} />
          <span className="absolute -top-1 -right-1">
            <SkyArt scene={scene} day={day} size={92} />
          </span>
          <span className="absolute inset-0 p-3 flex flex-col text-left" style={inkOn(scene, day)}>
            <span className="text-[11px] truncate pr-14" style={{ opacity: 0.85 }}>
              {shortPlace(wx.place)}
            </span>
            <span className="text-[38px] leading-none font-light tabular-nums mt-1">{wx.current.temp}°</span>
            <span className="flex-1" />
            <span className="text-[11px] truncate">
              {textOf(wx.current.code)}
              {today ? `  ${today.min}° / ${today.max}°` : ""}
            </span>
          </span>
        </>
      ) : (
        // 空状态这行是这张卡当下的正文，不是附注——用 --ink-dim，别用 faint
        <span className="h-full grid place-items-center text-[12px]" style={{ color: "var(--ink-dim)" }}>
          在看外面…
        </span>
      )}
    </BleedCard>
  );
}

const dayName = (date: string, i: number) =>
  i === 0 ? "今天" : i === 1 ? "明天" : `周${"日一二三四五六"[new Date(`${date}T00:00`).getDay()]}`;

function WeatherWide({ settings, onOpen }: Props) {
  const wx = useWeather(settings.weatherPlace);
  const scene = wx ? sceneOf(wx.current.code) : "cloudy";
  const day = wx?.current.day ?? true;
  const days = (wx?.daily ?? []).slice(0, 5);
  return (
    <BleedCard app="weather" onOpen={onOpen} label="天气 · 几天" empty={!wx}>
      {wx ? (
        <>
          <Sky scene={scene} day={day} />
          <span className="absolute -top-2 right-1">
            <SkyArt scene={scene} day={day} size={80} />
          </span>
          <span className="absolute inset-0 px-3.5 pt-2.5 pb-2.5 flex flex-col text-left" style={inkOn(scene, day)}>
            <span className="flex items-baseline gap-2 pr-20 min-w-0">
              <span className="text-[30px] leading-none font-light tabular-nums shrink-0">{wx.current.temp}°</span>
              <span className="text-[12px] truncate">
                {textOf(wx.current.code)} · {shortPlace(wx.place)}
              </span>
            </span>
            <span className="flex-1" />
            <span className="grid grid-cols-5 gap-1 text-center">
              {days.map((d, i) => (
                <span key={d.date} className="flex flex-col items-center gap-1">
                  <span className="text-[10px]" style={{ opacity: 0.85 }}>
                    {dayName(d.date, i)}
                  </span>
                  <Glyph code={d.code} day size={18} />
                  <span className="text-[10px] tabular-nums">
                    {d.min}°/{d.max}°
                  </span>
                </span>
              ))}
            </span>
          </span>
        </>
      ) : (
        <span className="h-full grid place-items-center text-[12px]" style={{ color: "var(--ink-dim)" }}>
          在看外面…
        </span>
      )}
    </BleedCard>
  );
}

/// 日出日落。**太阳走到哪儿了，画在一条弧上。**
///
/// 弧是一段正弦：日出、日落正好压在地平线上，中间最高；两头各多画出去四分之一个白天，
/// 落到地平线下面——这样天黑以后那个点还在线上，只是沉下去了。
/// ⚠️ 时间用接口换算好的绝对时间戳（见 /api/weather 的 localToEpoch），
/// 不拿 "05:37" 这种不带时区的字符串在手机上 new Date。
const hm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function SunArc({ settings, onOpen }: Props) {
  const wx = useWeather(settings.weatherPlace);
  /// 0 = 还没挂载。不在渲染时直接读时间（水合）
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const d0 = wx?.daily?.[0];
  const rise = d0?.sunrise;
  const set = d0?.sunset;
  const nextRise = wx?.daily?.[1]?.sunrise;
  const ready = !!(wx && now && rise && set && set > rise);

  let body: React.ReactNode = (
    <span className="h-full grid place-items-center text-[12px]" style={{ color: "var(--ink-dim)" }}>
      在看太阳…
    </span>
  );

  if (ready && wx && rise && set) {
    const L = set - rise;
    const start = rise - L * 0.25;
    const end = set + L * 0.25;
    // 弧占卡片右边大半，左边留给字。单位是卡片宽、高的百分比
    const X0 = 36;
    const X1 = 96;
    const H = 66;
    const A = 40;
    const pt = (t: number) => ({
      x: X0 + ((t - start) / (end - start)) * (X1 - X0),
      y: H - A * Math.sin((Math.PI * (t - rise)) / L),
    });
    const path = Array.from({ length: 49 }, (_, i) => pt(start + (i / 48) * (end - start)))
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    const up = now >= rise && now <= set;
    const sun = pt(Math.min(end, Math.max(start, now)));
    const scene = sceneOf(wx.current.code);
    const ink = inkOn(scene, up);
    const top = up
      ? `日落 ${hm(set)}`
      : now < rise
        ? `日出 ${hm(rise)}`
        : nextRise
          ? `明日日出 ${hm(nextRise)}`
          : "";
    const bottom = up ? (nextRise ? `明日日出 ${hm(nextRise)}` : "") : `今天日落 ${hm(set)}`;
    body = (
      <>
        <Sky scene={scene} day={up} />
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* 拉伸过的坐标系里线会被压扁，non-scaling-stroke 让粗细不跟着变 */}
          <line x1="0" x2="100" y1={H} y2={H} stroke={ink.color} strokeOpacity="0.28" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={ink.color} strokeOpacity="0.5" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* 太阳单独画成一个点：放进上面那张拉伸过的 SVG 里，圆会被压成椭圆 */}
        <span
          className="absolute rounded-full"
          data-sun={up ? "up" : "down"}
          style={{
            left: `${sun.x}%`,
            top: `${sun.y}%`,
            width: 14,
            height: 14,
            transform: "translate(-50%, -50%)",
            background: up ? "oklch(0.97 0.1 95)" : "oklch(0.9 0.03 250)",
            boxShadow: up ? "0 0 14px 5px oklch(0.97 0.12 95 / 0.65)" : "none",
            opacity: up ? 1 : 0.55,
          }}
        />
        <span className="absolute inset-0 px-3.5 py-2.5 flex flex-col text-left" style={ink}>
          <span className="flex justify-between gap-2 text-[11px]">
            <span className="truncate" style={{ opacity: 0.85 }}>
              {shortPlace(wx.place)}
            </span>
            <span className="shrink-0 tabular-nums">{top}</span>
          </span>
          <span className="text-[34px] leading-none font-light tabular-nums mt-1">{wx.current.temp}°</span>
          <span className="flex-1" />
          <span className="flex justify-between gap-2 text-[11px]">
            <span className="truncate">
              {textOf(wx.current.code)}
              {d0 ? `  ${d0.min}° / ${d0.max}°` : ""}
            </span>
            <span className="shrink-0 tabular-nums" style={{ opacity: 0.85 }}>
              {bottom}
            </span>
          </span>
        </span>
      </>
    );
  }

  return (
    <BleedCard app="weather" onOpen={onOpen} label="日出日落" empty={!ready}>
      {body}
    </BleedCard>
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
  if (id === "weatherWide") return <WeatherWide {...rest} />;
  if (id === "sun") return <SunArc {...rest} />;
  if (id === "music") return <Music {...rest} />;
  if (id === "days") return <Days {...rest} />;
  if (id === "photos") return <PhotoFrame {...rest} pick={rest.settings.photoWidget} label="相册" />;
  if (id === "photosWide")
    return <PhotoFrame {...rest} pick={rest.settings.photoWideWidget} label="相册 · 宽" />;
  if (id === "notes") return <Notes {...rest} />;
  return null;
}

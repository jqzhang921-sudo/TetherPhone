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
function Card({
  app,
  onOpen,
  children,
  className = "",
}: {
  app: string;
  onOpen: Props["onOpen"];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onOpen(app, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      className={`glass rounded-3xl px-4 py-3 text-left active:scale-[0.98] transition-transform ${className}`}
    >
      {children}
    </button>
  );
}

function Clock({ onOpen }: Props) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="glass rounded-3xl h-[86px]" />;
  return (
    <Card app="settings" onOpen={onOpen} className="col-span-4">
      <div className="text-[34px] leading-none font-light tabular-nums" style={{ color: "var(--ink)" }}>
        {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
      </div>
      <div className="text-[12px] mt-1.5" style={{ color: "var(--ink-dim)" }}>
        {now.getMonth() + 1}月{now.getDate()}日 星期{"日一二三四五六"[now.getDay()]}
      </div>
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
    <Card app="weather" onOpen={onOpen} className="col-span-2">
      {wx ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[28px] leading-none font-light tabular-nums" style={{ color: "var(--ink)" }}>
              {wx.current.temp}°
            </span>
            <span style={{ color: "var(--ink-dim)" }}>
              <Glyph code={wx.current.code} day={wx.current.day} size={24} />
            </span>
          </div>
          <div className="text-[11px] mt-1.5 truncate" style={{ color: "var(--ink-dim)" }}>
            {textOf(wx.current.code)}
          </div>
          <div className="text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
            {wx.place}
          </div>
        </>
      ) : (
        <div className="text-[11px] py-3" style={{ color: "var(--ink-faint)" }}>
          在看外面…
        </div>
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
    <Card app="music" onOpen={onOpen} className="col-span-2">
      <span className="flex items-center -space-x-2">
        <Avatar face={me} size={28} ring />
        {c && <Avatar face={faceOf(c)} size={28} ring />}
      </span>
      {p.track ? (
        <>
          <div className="text-[12px] mt-2 truncate" style={{ color: "var(--ink)" }}>
            {p.track.title}
          </div>
          <div className="text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
            {c ? (p.playing ? `正在和${displayName(c)}一起听` : "停着") : "自己听"}
          </div>
        </>
      ) : (
        <>
          <div className="text-[12px] mt-2" style={{ color: "var(--ink)" }}>
            {c ? `和${displayName(c)}` : "一起听"}
          </div>
          <div className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
            {c?.songs ? `听过 ${c.songs} 首` : "还没一起听过"}
          </div>
        </>
      )}
    </Card>
  );
}

function Photos({ settings, contacts, onOpen }: Props) {
  const [rows, setRows] = useState<Photo[]>([]);
  useEffect(() => {
    const c = contacts.find((x) => x.id === settings.togetherWith) ?? contacts[0];
    if (!c) return;
    void loadPhotos(c.id).then((all) => setRows(all.filter((x) => x.saved).slice(0, 3)));
  }, [contacts, settings.togetherWith]);

  return (
    <Card app="photos" onOpen={onOpen} className="col-span-2">
      {rows.length ? (
        <div className="grid grid-cols-3 gap-1">
          {rows.map((r) => (
            <PhotoImg key={r.id} photo={r} className="w-full rounded-md object-cover"
              style={{ aspectRatio: "1 / 1" }} />
          ))}
        </div>
      ) : (
        <div className="text-[11px] py-3" style={{ color: "var(--ink-faint)" }}>
          相册还空着
        </div>
      )}
      <div className="text-[10px] mt-1.5" style={{ color: "var(--ink-faint)" }}>
        相册
      </div>
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
    <Card app="notes" onOpen={onOpen} className="col-span-4">
      {rows.length ? (
        <div className="flex flex-col gap-1.5">
          {rows.map((n) => (
            <div key={n.id} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: paperOf(n.id) }} />
              <span className="text-[12px] truncate" style={{ color: "var(--ink)" }}>
                {n.text}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] py-1" style={{ color: "var(--ink-faint)" }}>
          板上没有待办
        </div>
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

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sky } from "@/components/weather/sky";
import { Glyph } from "@/components/weather/glyph";
import { sceneOf, skyCss, skyIsDark, textOf } from "@/lib/weather/wmo";
import type { Settings } from "@/lib/os/settings";

type Report = {
  place: string;
  /// 位置怎么来的。ip = 按网络出口猜的，得让人看出来。
  source: "query" | "coords" | "ip";
  current: {
    temp: number;
    feels: number;
    humidity: number;
    wind: number;
    code: number;
    day: boolean;
  };
  hourly: { t: string; temp: number; code: number }[];
  daily: { date: string; code: number; max: number; min: number }[];
};

const hourLabel = (iso: string) => `${new Date(iso).getHours()}时`;
const WEEK = "日一二三四五六";

export function WeatherApp({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
}) {
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const asked = useRef(false);

  const fetchAt = useCallback(async (qs: string) => {
    setErr(null);
    try {
      const r = await fetch(`/api/weather${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setData(j as Report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    // 记住的城市优先——它是用户明确说过的，比任何自动定位都准。
    if (settings.weatherPlace.trim()) {
      void fetchAt(`?q=${encodeURIComponent(settings.weatherPlace.trim())}`);
      return;
    }

    // ⚠️ geolocation 只在 HTTPS（和 localhost）下可用。从局域网 http 打开时
    // 这个对象在有些浏览器里干脆不存在，在有些里回调永远不来——所以既要
    // 判断存在性，也要给超时，不能干等。
    if (!("geolocation" in navigator)) {
      void fetchAt("");
      return;
    }
    let settled = false;
    const fallback = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      void fetchAt("");
    }, 4000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(fallback);
        void fetchAt(`?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
      },
      () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(fallback);
        void fetchAt("");
      },
      { timeout: 3500, maximumAge: 10 * 60_000 },
    );
    return () => window.clearTimeout(fallback);
  }, [fetchAt, settings.weatherPlace]);

  const scene = data ? sceneOf(data.current.code) : "cloudy";
  const day = data?.current.day ?? true;
  const dark = skyIsDark(scene, day);

  return (
    <div
      // 天气自己决定深浅，不跟壁纸走——雨天的天空是暗的，哪怕壁纸是浅的。
      // data-tone 在这一层重新定义 --ink 那几个变量，玻璃卡和字自动跟上。
      data-tone={dark ? "dark" : "light"}
      className="relative w-full h-full overflow-hidden"
      style={{ background: skyCss(scene, day), transition: "background 800ms ease" }}
    >
      {data && <Sky scene={scene} day={day} wind={data.current.wind} />}

      <div className="absolute inset-0 overflow-y-auto no-bar px-5 pt-12 pb-14">
        {!data && !err && (
          <p className="text-[13px] pt-24 text-center" style={{ color: "var(--ink-dim)" }}>
            在看外面…
          </p>
        )}

        {err && (
          <div className="pt-20 text-center">
            <p className="text-[13px] mb-3" style={{ color: "var(--ink-dim)" }}>
              {err}
            </p>
            <button
              onClick={() => setEditing(true)}
              className="glass rounded-full px-4 py-2 text-[13px]"
              style={{ color: "var(--ink)" }}
            >
              手动填个城市
            </button>
          </div>
        )}

        {data && (
          <>
            <div className="text-center pt-3">
              <button
                onClick={() => {
                  setQuery(settings.weatherPlace);
                  setEditing(true);
                }}
                className="text-[15px] active:opacity-60"
                style={{ color: "var(--ink-dim)" }}
              >
                {data.place}
              </button>
              {data.source === "ip" && (
                <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-faint)" }}>
                  按网络位置猜的 · 点上面改
                </div>
              )}
              <div
                className="text-[86px] leading-none font-extralight tabular-nums mt-1"
                style={{ color: "var(--ink)", textShadow: "0 2px 30px oklch(0 0 0 / 0.22)" }}
              >
                {data.current.temp}°
              </div>
              <div className="text-[15px] mt-1" style={{ color: "var(--ink)" }}>
                {textOf(data.current.code)}
              </div>
              <div className="text-[12px] mt-1" style={{ color: "var(--ink-faint)" }}>
                体感 {data.current.feels}° · 湿度 {data.current.humidity}% · 风 {data.current.wind} km/h
              </div>
            </div>

            <div className="glass rounded-2xl mt-6 py-3">
              <div className="flex gap-4 overflow-x-auto no-bar px-4">
                {data.hourly.map((h, i) => (
                  <div key={h.t} className="shrink-0 flex flex-col items-center gap-1.5 w-11">
                    <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      {i === 0 ? "现在" : hourLabel(h.t)}
                    </span>
                    <span style={{ color: "var(--ink-dim)" }}>
                      <Glyph code={h.code} day={new Date(h.t).getHours() > 6 && new Date(h.t).getHours() < 19} size={20} />
                    </span>
                    <span className="text-[13px] tabular-nums" style={{ color: "var(--ink)" }}>
                      {h.temp}°
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass rounded-2xl mt-3 px-4 py-1">
              {data.daily.map((d, i) => {
                const dt = new Date(d.date);
                // 一周里最冷和最热的那一端，用来画那条温度条的比例
                const lo = Math.min(...data.daily.map((x) => x.min));
                const hi = Math.max(...data.daily.map((x) => x.max));
                const span = Math.max(1, hi - lo);
                return (
                  <div key={d.date} className="flex items-center gap-3 py-2.5">
                    <span className="w-10 text-[13px]" style={{ color: "var(--ink)" }}>
                      {i === 0 ? "今天" : `周${WEEK[dt.getDay()]}`}
                    </span>
                    <span style={{ color: "var(--ink-dim)" }}>
                      <Glyph code={d.code} size={20} />
                    </span>
                    <span className="w-8 text-right text-[13px] tabular-nums" style={{ color: "var(--ink-faint)" }}>
                      {d.min}°
                    </span>
                    <span className="flex-1 h-1 rounded-full relative" style={{ background: "oklch(0.5 0 0 / 0.22)" }}>
                      <span
                        className="absolute h-1 rounded-full"
                        style={{
                          left: `${((d.min - lo) / span) * 100}%`,
                          width: `${((d.max - d.min) / span) * 100}%`,
                          background: "linear-gradient(90deg, oklch(0.72 0.11 230), oklch(0.80 0.13 70))",
                        }}
                      />
                    </span>
                    <span className="w-8 text-right text-[13px] tabular-nums" style={{ color: "var(--ink)" }}>
                      {d.max}°
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {editing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8"
          style={{ background: "oklch(0 0 0 / 0.45)" }}>
          <div className="glass-strong rounded-3xl p-5 w-full">
            <p className="text-[12px] mb-2" style={{ color: "var(--ink-faint)" }}>
              自动定位认的是网络出口，家宽常常落在省会甚至邻省。填一个准的。
            </p>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const q = query.trim();
                onChange({ weatherPlace: q });
                setEditing(false);
                void fetchAt(q ? `?q=${encodeURIComponent(q)}` : "");
              }}
              placeholder="郑州"
              className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
              style={{
                background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
                border: "1px solid var(--glass-edge)",
                color: "var(--ink)",
              }}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-2xl py-2.5 text-[14px]"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                算了
              </button>
              <button
                onClick={() => {
                  const q = query.trim();
                  onChange({ weatherPlace: q });
                  setEditing(false);
                  void fetchAt(q ? `?q=${encodeURIComponent(q)}` : "");
                }}
                className="flex-1 rounded-2xl py-2.5 text-[14px]"
                style={{ background: "oklch(0.62 0.14 250)", color: "oklch(0.99 0 0)" }}
              >
                就这儿
              </button>
            </div>
            {settings.weatherPlace && (
              <button
                onClick={() => {
                  onChange({ weatherPlace: "" });
                  setEditing(false);
                  void fetchAt("");
                }}
                className="w-full text-[12px] pt-3"
                style={{ color: "var(--ink-faint)" }}
              >
                改回自动定位
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

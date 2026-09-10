"use client";
import { useCallback, useEffect, useState } from "react";
import {
  deleteTrack,
  loadTracks,
  localTrack,
  lyric as fetchLyric,
  saveTrack,
  search,
  PHONE,
  type Found,
  type Track,
} from "@/lib/music/store";
import { mmss, usePlayer } from "@/components/phone/player";
import { newId } from "@/lib/id";
import type { Settings } from "@/lib/os/settings";

function Bars({ on }: { on: boolean }) {
  return (
    <span className="flex items-end gap-[2px] h-3.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            background: "currentColor",
            height: on ? undefined : "40%",
            animation: on ? `bar 900ms ${i * 140}ms ease-in-out infinite` : "none",
          }}
        />
      ))}
    </span>
  );
}

export function MusicApp({ settings }: { settings: Settings }) {
  const p = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tab, setTab] = useState<"lib" | "find">("lib");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState<string | null>(null);

  const base = settings.musicApiBase.trim();
  const refresh = useCallback(async () => setTracks(await loadTracks()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) await saveTrack(localTrack(f));
    await refresh();
  };

  const runSearch = async () => {
    if (!q.trim()) return;
    if (!base) return setNote("还没配音源地址。设置 → 音乐里填一个。");
    setBusy(true);
    setNote(null);
    try {
      setFound(await search(base, q.trim()));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addOnline = async (f: Found, andPlay: boolean) => {
    const t: Track = {
      id: newId(),
      contactId: PHONE,
      kind: "online",
      title: f.title,
      artist: f.artist,
      songId: f.songId,
      cover: f.cover,
      at: Date.now(),
    };
    await saveTrack(t);
    const next = await loadTracks();
    setTracks(next);
    if (andPlay) p.play(t, next);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <style>{`@keyframes bar { 0%,100% { height: 30% } 50% { height: 100% } }`}</style>

      {/* 正在放的那首。**没在放就不占位置**——空的播放器条比没有更碍事 */}
      {p.track && (
        <div className="shrink-0 glass rounded-2xl mx-4 mb-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <span style={{ color: "var(--ink-dim)" }}>
              <Bars on={p.playing} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                {p.track.title}
              </span>
              <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                {p.track.artist || (p.track.kind === "online" ? "在线" : "本地文件")}
              </span>
            </span>
            <button onClick={p.prev} className="p-1.5 active:opacity-50" aria-label="上一首">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="var(--ink-dim)">
                <path d="M7 6h2v12H7zM19 6v12l-9-6z" />
              </svg>
            </button>
            <button onClick={p.toggle} className="p-1.5 active:opacity-50" aria-label="播放暂停">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--ink)">
                {p.playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5l12 7-12 7z" />}
              </svg>
            </button>
            <button onClick={p.next} className="p-1.5 active:opacity-50" aria-label="下一首">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="var(--ink-dim)">
                <path d="M15 6h2v12h-2zM5 6l9 6-9 6z" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <span className="text-[10px] tabular-nums w-8" style={{ color: "var(--ink-faint)" }}>
              {mmss(p.at)}
            </span>
            <input
              type="range"
              min={0}
              max={p.len || 0}
              value={p.at}
              onChange={(e) => p.seek(Number(e.target.value))}
              className="flex-1 h-1 accent-current"
              style={{ color: "var(--ink-dim)" }}
            />
            <span className="text-[10px] tabular-nums w-8 text-right" style={{ color: "var(--ink-faint)" }}>
              {mmss(p.len)}
            </span>
          </div>

          {p.track.kind === "online" && (
            <button
              onClick={async () => {
                if (words !== null) return setWords(null);
                setWords(await fetchLyric(base, p.track!.songId!));
              }}
              className="text-[11px] pt-1"
              style={{ color: "var(--ink-faint)" }}
            >
              {words === null ? "看歌词" : "收起歌词"}
            </button>
          )}
          {words !== null && (
            <pre
              className="text-[12px] leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto no-bar mt-1"
              style={{ color: "var(--ink-dim)", fontFamily: "inherit" }}
            >
              {words.replace(/\[[\d:.]+\]/g, "").trim() || "这首没有歌词"}
            </pre>
          )}

          {p.trial && (
            <p className="text-[11px] pt-1" style={{ color: "var(--ink-dim)" }}>
              这首只有试听片段{p.len > 0 ? `，${mmss(p.len)} 就断` : ""}——完整版要登录有会员的账号。
            </p>
          )}
          {p.err && (
            <p className="text-[11px] pt-1" style={{ color: "oklch(0.65 0.19 25)" }}>
              {p.err}
            </p>
          )}
        </div>
      )}

      <div className="shrink-0 flex gap-2 px-4 pb-2">
        {(["lib", "find"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-full text-[12px]"
            style={{
              background:
                tab === t ? "color-mix(in oklab, var(--glass-tint) 95%, transparent)" : "transparent",
              color: tab === t ? "var(--ink)" : "var(--ink-faint)",
            }}
          >
            {t === "lib" ? "曲库" : "找歌"}
          </button>
        ))}
      </div>

      {tab === "lib" ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-3">
            {tracks.length === 0 ? (
              <div className="h-full grid place-items-center px-8 text-center">
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                  曲库是空的。
                  <br />
                  加几个本地文件，或者配了音源之后去「找歌」。
                </p>
              </div>
            ) : (
              tracks.map((t) => {
                const on = p.track?.id === t.id;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-2 py-2.5">
                    <button
                      onClick={() => p.play(t, tracks)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left active:opacity-60"
                    >
                      <span
                        className="shrink-0 w-9 h-9 rounded-lg grid place-items-center"
                        style={{
                          background: "color-mix(in oklab, var(--glass-tint) 80%, transparent)",
                          color: on ? "var(--ink)" : "var(--ink-faint)",
                        }}
                      >
                        {on ? <Bars on={p.playing} /> : (t.kind === "online" ? "♪" : "▸")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                          {t.title}
                        </span>
                        <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                          {t.artist || (t.kind === "online" ? "在线" : "本地文件")}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={async () => {
                        await deleteTrack(t.id);
                        await refresh();
                      }}
                      className="text-[11px] px-1"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      移出
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 px-4 pb-2">
            <label
              className="glass-strong block w-full rounded-2xl py-3 text-[14px] text-center"
              style={{ color: "var(--ink)" }}
            >
              加本地文件
              <input
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void add(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 px-3 pb-2">
            <div className="glass-strong rounded-[22px] flex items-center gap-2 px-3.5 py-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                placeholder={base ? "歌名或歌手" : "先去设置里配音源地址"}
                disabled={!base}
                className="flex-1 bg-transparent outline-none text-[14px] py-1"
                style={{ color: "var(--ink)" }}
              />
              <button onClick={() => void runSearch()} disabled={busy || !base}
                className="text-[13px] disabled:opacity-40" style={{ color: "var(--ink)" }}>
                {busy ? "找…" : "找"}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-3">
            {!base && (
              <p className="text-[12px] leading-relaxed px-4 pt-6 text-center" style={{ color: "var(--ink-faint)" }}>
                在线找歌需要一个音源服务。
                <br />
                它不在这个 App 里——你得自己跑一个，然后把地址填进设置。
              </p>
            )}
            {found.map((f) => (
              <button
                key={f.songId}
                onClick={() => void addOnline(f, true)}
                className="w-full flex items-center gap-3 px-2 py-2.5 text-left active:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                    {f.title}
                  </span>
                  <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                    {f.artist}
                  </span>
                </span>
                {/* 拿不到完整音源的先标出来，别等点下去才发现没声音 */}
                {f.vip && (
                  <span
                    className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "oklch(0.75 0.12 70 / 0.25)", color: "var(--ink-dim)" }}
                  >
                    要会员
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {note && (
        <p className="shrink-0 text-center text-[11px] pb-2 px-6" style={{ color: "var(--ink-faint)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

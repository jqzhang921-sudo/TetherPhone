"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { analyze, describe } from "@/lib/music/analyze";
import { completeOnce, identity } from "@/lib/ai";
import { displayName, type Contact } from "@/lib/os/contacts";
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

/// 一起听了多久。**不满一分钟就说秒**——「一起听了 0 分钟」看着像坏了。
function span(sec: number) {
  if (sec < 60) return `${Math.floor(sec)} 秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function MusicApp({
  settings,
  contacts,
  onChange,
}: {
  settings: Settings;
  contacts: Contact[];
  onChange: (p: Partial<Settings>) => void;
}) {
  const p = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tab, setTab] = useState<"lib" | "find">("lib");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [remark, setRemark] = useState<string | null>(null);
  /// 每首只问一次。不加这个，进度更新会把它反复叫醒。
  const asked = useRef<string | null>(null);

  const together = contacts.find((c) => c.id === settings.togetherWith) ?? null;

  const base = settings.musicApiBase.trim();

  /// 换了一首歌，它可能想说一句。
  ///
  /// ⚠️ 提示词里**明说它听不到声音**，只看得到歌名和歌词。不说这句，它会写出
  /// 「这个前奏真好听」这种它根本没听到的话——那是演，不是陪着。
  ///
  /// ⚠️ 它可以回「不说」，而且提示词里写了这是常有的事。换一首就非要评一句，
  /// 就成了每首歌都要交作业。
  useEffect(() => {
    const t = p.track;
    if (!together || !t || !settings.apiKey) return;
    if (asked.current === t.id) return;
    asked.current = t.id;
    setRemark(null);
    void (async () => {
      let objUrl: string | null = null;
      try {
        let lrc = "";
        let sound = "";

        if (t.kind === "online" && t.songId && base) {
          lrc = (await fetchLyric(base, t.songId)).replace(/\[[\d:.]+\]/g, "").trim().slice(0, 300);
        }

        // 量一下这段声波。**能量出来是因为音频现在是同源的**
        // （本地文件本来就是；在线的经本站转发之后也是）。
        const src =
          t.kind === "local" && t.blob
            ? (objUrl = URL.createObjectURL(t.blob))
            : base && t.songId
              ? `/api/music?op=stream&base=${encodeURIComponent(base)}&id=${encodeURIComponent(t.songId)}`
              : null;
        if (src) {
          const f = await analyze(src);
          if (f) sound = describe(f);
        }

        const said = await completeOnce(
          settings,
          together,
          [
            ...identity(together, settings),
            `你们在一起听歌。现在放的是《${t.title}》${t.artist ? " - " + t.artist : ""}。`,
            lrc ? `歌词（节选）：\n${lrc}` : "",
            sound ? `这首**量出来**的样子：${sound}。` : "",
            // ⚠️ 这段话是整个设计的关键。给了数据就更要说清楚数据是什么，
            // 否则它会顺着「你能感受音乐」演下去——那正是要避免的。
            "⚠️ 上面那些是从声波里量出来的数，**不是你听到的**——你没有听觉。",
            "可以据此说话（比如「这首挺快的」「后面突然响起来了」），",
            "但别写「我听到…」「这个前奏真好听」这种假装有听觉的话。",
            "想说点什么就只输出那句话（一句，短，像并排坐着随口说的）；",
            "没什么想说的就输出「不说」——**这也是常有的事，别硬凑**。",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        const w = said.trim();
        if (w && !/^(不说|没有|无|不评论)$/.test(w)) setRemark(w);
      } catch {
        // 说不出来就算了，不该让一句闲话变成一条报错
      } finally {
        if (objUrl) URL.revokeObjectURL(objUrl);
      }
    })();
  }, [p.track, together, settings, base]);
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
              这首只有试听片段{p.len > 0 ? `，${mmss(p.len)} 就断` : ""}——
              {p.loggedIn ? "你的账号没有这首的完整权限。" : "要先登录（见 tools/music-login.mjs）。"}
            </p>
          )}
          {p.err && (
            <p className="text-[11px] pt-1" style={{ color: "oklch(0.65 0.19 25)" }}>
              {p.err}
            </p>
          )}
        </div>
      )}

      {/* 一起听。**主题就是那两个头像和累计时间**，别的都别加——
          唱片转不转不重要，「有人和你在同一首歌里」才是这件事本身。 */}
      {contacts.length > 0 && (
        <div className="shrink-0 px-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center -space-x-2">
              <span
                className="w-7 h-7 rounded-full grid place-items-center text-[14px] ring-2"
                style={{ background: "oklch(0.7 0.02 250)", ["--tw-ring-color" as string]: "var(--glass-tint)" }}
              >
                {settings.userEmoji}
              </span>
              {contacts.map((c) => {
                const on = c.id === settings.togetherWith;
                return (
                  <button
                    key={c.id}
                    onClick={() => onChange({ togetherWith: on ? "" : c.id })}
                    className="w-7 h-7 rounded-full grid place-items-center text-[14px] ring-2 transition-opacity"
                    style={{
                      background: c.tint,
                      opacity: on ? 1 : 0.35,
                      ["--tw-ring-color" as string]: "var(--glass-tint)",
                    }}
                  >
                    {c.emoji}
                  </button>
                );
              })}
            </span>
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
              {together
                ? `和${displayName(together)}一起听了 ${span(together.together ?? 0)}`
                : "自己听 · 点头像叫上它"}
            </span>
          </div>

          {together && remark && (
            <p className="text-[12px] leading-relaxed pt-1.5 pl-1" style={{ color: "var(--ink-dim)" }}>
              <span style={{ color: together.tint }}>{displayName(together)}</span>
              <span style={{ color: "var(--ink-faint)" }}>：</span>
              {remark}
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

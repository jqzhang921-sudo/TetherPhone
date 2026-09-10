"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mmss, usePlayer } from "@/components/phone/player";
import { analyze, describe } from "@/lib/music/analyze";
import { skyOf, toneFromImage, type Tone } from "@/lib/music/tone";
import { coverUrl, lyric as fetchLyric } from "@/lib/music/store";
import { WALLPAPERS, wallpaperById } from "@/lib/os/wallpapers";
import { completeOnce, identity } from "@/lib/ai";
import { loadMsgs, newId, saveMsgs, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "@/components/phone/avatar";
import { faceOf, useMe } from "@/lib/os/avatar";

type Bubble = { id: string; who: "me" | "them"; text: string };

const span = (sec: number) => {
  if (sec < 60) return `${Math.floor(sec)} 秒`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
};

/// 全屏播放页。
///
/// 布局是照着「播放器」来的，不是照着列表：封面占最大一块，两个头像在**中间偏上**
/// ——一进来先看到「谁和你在这儿」，再看到在听什么。
///
/// 背景默认**从封面取色**（见 lib/music/tone.ts，走 OKLab 加权投票），
/// 也可以钉死成某张壁纸。
export function MusicPlayer({
  settings,
  together,
  onChange,
  onClose,
}: {
  settings: Settings;
  together: Contact | null;
  onChange: (p: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const p = usePlayer();
  const me = useMe(settings);
  const [tone, setTone] = useState<Tone | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const asked = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const base = settings.musicApiBase.trim();
  const t = p.track;
  const cover = t?.kind === "online" && t.cover ? coverUrl(base, t.cover) : "";

  // 背景：跟封面 or 钉死的壁纸
  const pinned = settings.musicBg && settings.musicBg !== "cover";
  const sky = pinned ? wallpaperById(settings.musicBg).css : skyOf(tone);
  const dark = pinned ? wallpaperById(settings.musicBg).tone === "dark" : (tone?.dark ?? true);

  useEffect(() => {
    if (!cover) return setTone(null);
    void toneFromImage(cover).then(setTone);
  }, [cover]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, busy]);

  /// 换歌时它可能说一句。**这句不落库**——没人接的闲话不该留痕。
  /// 她回一句之后，这一来一回才一起写进对话（见 send）。
  useEffect(() => {
    if (!together || !t || !settings.apiKey) return;
    if (asked.current === t.id) return;
    asked.current = t.id;
    setBubbles([]);
    void (async () => {
      let obj: string | null = null;
      try {
        let lrc = "";
        if (t.kind === "online" && t.songId && base) {
          lrc = (await fetchLyric(base, t.songId)).replace(/\[[\d:.]+\]/g, "").trim().slice(0, 300);
        }
        const src =
          t.kind === "local" && t.blob
            ? (obj = URL.createObjectURL(t.blob))
            : base && t.songId
              ? `/api/music?op=stream&base=${encodeURIComponent(base)}&id=${encodeURIComponent(t.songId)}`
              : null;
        let sound = "";
        if (src) {
          const f = await analyze(src);
          if (f) sound = describe(f);
        }
        const said = await completeOnce(settings, together, songPrompt(t.title, t.artist, lrc, sound, settings, together));
        const w = said.trim();
        if (w && !/^(不说|没有|无|不评论)$/.test(w)) {
          setBubbles([{ id: newId(), who: "them", text: w }]);
        }
      } catch {
        /* 说不出来就算了，一句闲话不该变成一条报错 */
      } finally {
        if (obj) URL.revokeObjectURL(obj);
      }
    })();
  }, [t, together, settings, base]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !together || !t) return;
    setInput("");
    const mine: Bubble = { id: newId(), who: "me", text };
    const shown = [...bubbles, mine];
    setBubbles(shown);
    setBusy(true);
    try {
      // 有来有回了，这段才写进对话。
      // **它单方面说的那句在没人接之前不落库**——听二十首歌就往聊天里灌
      // 二十条，那不是陪着，那是刷屏。
      const keep: Msg[] = shown.map((b) => ({
        id: b.id,
        contactId: together.id,
        role: b.who === "me" ? "user" : "assistant",
        content: b.text,
        at: Date.now(),
      }));
      const already = await loadMsgs(together.id);
      const fresh = keep.filter((k) => !already.some((a) => a.id === k.id));
      if (fresh.length) await saveMsgs(fresh);

      const recent = (await loadMsgs(together.id))
        .filter((m) => m.role !== "event")
        .slice(-10)
        .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
        .join("\n");

      const said = await completeOnce(
        settings,
        together,
        [
          ...identity(together, settings),
          `你们在一起听《${t.title}》${t.artist ? " - " + t.artist : ""}。`,
          `刚才说到：\n${recent}`,
          "接着聊。一两句，像并排坐着说话，别长。只输出你要说的那句。",
        ].join("\n"),
      );
      const w = said.trim();
      if (w) {
        const reply: Bubble = { id: newId(), who: "them", text: w };
        setBubbles((b) => [...b, reply]);
        await saveMsgs([
          { id: reply.id, contactId: together.id, role: "assistant", content: w, at: Date.now() },
        ]);
      }
    } catch {
      /* 网络抽风就算了，气泡还在，她能再试 */
    } finally {
      setBusy(false);
    }
  }, [input, busy, together, t, bubbles, settings]);

  if (!t) return null;

  return (
    <div
      data-tone={dark ? "dark" : "light"}
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: sky, transition: "background 700ms ease" }}
    >
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-2 pb-1">
        <button onClick={onClose} className="p-1.5 -ml-1.5 active:opacity-50" aria-label="收起">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--ink)"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button onClick={() => setPicking((v) => !v)} className="text-[12px] px-2 py-1 active:opacity-50"
          style={{ color: "var(--ink-faint)" }}>
          换背景
        </button>
      </div>

      {/* 两个头像：中间偏上。一进来先看到「谁和你在这儿」 */}
      <div className="shrink-0 flex flex-col items-center gap-1 pb-3">
        <span className="flex items-center -space-x-2.5">
          <Avatar face={me} size={44} ring />
          {together && <Avatar face={faceOf(together)} size={44} ring />}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {together
            ? `和${displayName(together)}一起听了 ${span(together.together ?? 0)}`
            : "自己听"}
        </span>
      </div>

      {/* 封面。**多出来的竖向空间给它**——气泡少的时候封面大一点，
          比在封面和气泡之间留一块莫名其妙的空白好看。 */}
      <div className="flex-1 min-h-0 px-10 grid place-items-center">
        <div
          className="rounded-[26px] overflow-hidden grid place-items-center"
          style={{
            width: "min(100%, 62vh)",
            aspectRatio: "1 / 1",
            background: "color-mix(in oklab, var(--glass-tint) 30%, transparent)",
            boxShadow: "0 18px 48px oklch(0 0 0 / 0.35)",
          }}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="var(--ink-faint)"
              strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 17V5l10-2v12" />
              <circle cx="6.5" cy="17.5" r="2.6" />
              <circle cx="16.5" cy="15.5" r="2.6" />
            </svg>
          )}
        </div>
      </div>

      <div className="shrink-0 px-8 pt-4 text-center">
        <div className="text-[19px] font-medium truncate" style={{ color: "var(--ink)" }}>
          {t.title}
        </div>
        <div className="text-[13px] truncate mt-0.5" style={{ color: "var(--ink-faint)" }}>
          {t.artist || (t.kind === "online" ? "在线" : "本地文件")}
        </div>
        {p.trial && (
          <div className="text-[11px] mt-1" style={{ color: "var(--ink-faint)" }}>
            只有试听片段{p.len > 0 ? ` · ${mmss(p.len)} 就断` : ""}
          </div>
        )}
      </div>

      {/* 气泡。两边都是毛玻璃，只靠左右位置分谁说的——
          她说过两边都白色或者都毛玻璃，那就别用颜色区分。 */}
      <div className="shrink-0 max-h-[30%] overflow-y-auto no-bar px-5 pt-3 flex flex-col gap-2">
        {bubbles.map((b) => (
          <div
            key={b.id}
            className={`glass-strong max-w-[80%] rounded-[18px] px-3.5 py-2 text-[14px] leading-relaxed ${
              b.who === "me" ? "self-end" : "self-start"
            }`}
            style={{ color: "var(--ink)" }}
          >
            {b.text}
          </div>
        ))}
        {busy && (
          <div className="glass-strong self-start rounded-[18px] px-3.5 py-2.5">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--ink-faint)", animationDelay: `${i * 160}ms` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* 进度 + 控制 */}
      <div className="shrink-0 px-6 pt-3">
        <input
          type="range"
          min={0}
          max={p.len || 0}
          value={p.at}
          onChange={(e) => p.seek(Number(e.target.value))}
          className="w-full h-1"
          style={{ accentColor: "var(--ink)" }}
        />
        <div className="flex justify-between text-[10px] tabular-nums pt-0.5" style={{ color: "var(--ink-faint)" }}>
          <span>{mmss(p.at)}</span>
          <span>{mmss(p.len)}</span>
        </div>
        <div className="flex items-center justify-center gap-8 pt-2">
          <button onClick={p.prev} className="active:opacity-50" aria-label="上一首">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="var(--ink-dim)">
              <path d="M7 6h2v12H7zM19 6v12l-9-6z" />
            </svg>
          </button>
          <button
            onClick={p.toggle}
            className="w-14 h-14 rounded-full grid place-items-center active:scale-95 transition-transform"
            style={{ background: "color-mix(in oklab, var(--glass-tint) 92%, transparent)" }}
            aria-label="播放暂停"
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="var(--ink)">
              {p.playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5l12 7-12 7z" />}
            </svg>
          </button>
          <button onClick={p.next} className="active:opacity-50" aria-label="下一首">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="var(--ink-dim)">
              <path d="M15 6h2v12h-2zM5 6l9 6-9 6z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 说点什么 */}
      {together && (
        <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="glass-strong rounded-[22px] flex items-end gap-2 px-3.5 py-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={`和${displayName(together)}说点什么…`}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] max-h-16 py-1.5"
              style={{ color: "var(--ink)" }}
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="shrink-0 w-8 h-8 mb-1 rounded-full grid place-items-center disabled:opacity-30"
              style={{ background: together.tint, color: "oklch(0.99 0 0)" }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {picking && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end">
          <button aria-label="关掉" onClick={() => setPicking(false)} className="absolute inset-0"
            style={{ background: "oklch(0 0 0 / 0.45)" }} />
          <div className="glass-strong relative rounded-t-[28px] px-5 pt-4 pb-6">
            <p className="text-[12px] mb-3" style={{ color: "var(--ink-faint)" }}>
              放歌时的背景
            </p>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => {
                  onChange({ musicBg: "cover" });
                  setPicking(false);
                }}
                className="rounded-2xl aspect-[9/16] grid place-items-center text-[11px]"
                style={{
                  background: skyOf(tone),
                  color: (tone?.dark ?? true) ? "oklch(0.97 0 0)" : "oklch(0.25 0 0)",
                  outline: !pinned ? "2px solid var(--ink)" : "1px solid var(--glass-edge)",
                  outlineOffset: !pinned ? "2px" : "0",
                }}
              >
                跟封面
              </button>
              {WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    onChange({ musicBg: w.id });
                    setPicking(false);
                  }}
                  className="rounded-2xl aspect-[9/16] relative"
                  style={{
                    background: w.css,
                    outline: settings.musicBg === w.id ? "2px solid var(--ink)" : "1px solid var(--glass-edge)",
                    outlineOffset: settings.musicBg === w.id ? "2px" : "0",
                  }}
                >
                  <span className="absolute bottom-1 left-0 right-0 text-[10px]"
                    style={{ color: w.tone === "dark" ? "oklch(0.97 0 0)" : "oklch(0.25 0 0)" }}>
                    {w.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/// 换歌那句的提示词。
/// ⚠️ 明说量出来的是数不是听觉——给了数据更要说清数据是什么。
function songPrompt(
  title: string,
  artist: string,
  lrc: string,
  sound: string,
  settings: Settings,
  c: Contact,
) {
  return [
    ...identity(c, settings),
    `你们在一起听歌。现在放的是《${title}》${artist ? " - " + artist : ""}。`,
    lrc ? `歌词（节选）：\n${lrc}` : "",
    sound ? `这首**量出来**的样子：${sound}。` : "",
    "⚠️ 上面那些是从声波里量出来的数，**不是你听到的**——你没有听觉。",
    "可以据此说话（比如「这首挺快的」「后面收下去了」），",
    "但别写「我听到…」「这个前奏真好听」这种假装有听觉的话。",
    "想说点什么就只输出那句话（一句，短，像并排坐着随口说的）；",
    "没什么想说的就输出「不说」——**这也是常有的事，别硬凑**。",
  ]
    .filter(Boolean)
    .join("\n");
}

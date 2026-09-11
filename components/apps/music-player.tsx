"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mmss, usePlayer } from "@/components/phone/player";
import { analyze, describe } from "@/lib/music/analyze";
import { skyOf, toneFromImage, type Tone } from "@/lib/music/tone";
import { coverUrl, likedIds, setLiked } from "@/lib/music/store";
import { lineAt } from "@/lib/music/lrc";
import { WALLPAPERS, wallpaperById } from "@/lib/os/wallpapers";
import { completeOnce, identity } from "@/lib/ai";
import { loadMsgs, newId, saveMsgs, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "@/components/phone/avatar";
import { TogetherSheet } from "./together-sheet";
import { faceOf, useMe } from "@/lib/os/avatar";

type Bubble = { id: string; who: "me" | "them"; text: string };

/// 歌词上下两头淡出。没有它，滚动的词会硬生生地从边上切断。
const FADE =
  "linear-gradient(to bottom, transparent 0, #000 14%, #000 86%, transparent 100%)";

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
  allContacts,
  onChange,
  onClose,
}: {
  settings: Settings;
  together: Contact | null;
  /// 挑人邀请要用全部联系人，`together` 只是已经在一起听的那个
  allContacts: Contact[];
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

  /// 歌词读播放器那一份，**这儿不自己再拿一次**。
  /// 它也要读歌词（见 player.tsx），既然那边已经拿了，两处各拿各的
  /// 就是同一首歌问两遍音源，而且两份还可能不一样。
  const [showWords, setShowWords] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  /// 待播清单那一层，和「一起听」那一层
  const [queueOpen, setQueueOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  /// 「我喜欢的音乐」里已经有的那些。**开页时问一次就够**，
  /// 每换一首都去问一遍等于替她刷接口。
  const [likes, setLikes] = useState<Set<string>>(new Set());
  const [likeErr, setLikeErr] = useState<string | null>(null);

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
        // 播放器已经拿过一份了，这儿直接用
        const lrc = (p.lines.length ? p.lines.map((l) => l.text) : p.plain)
          .join("\n")
          .slice(0, 300);
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
          // ⚠️ **这一句是「一起听」和「各听各的」之间的全部差别。**
          // 只给歌名的话，它只能聊这首歌是什么；给了正唱到的这句，
          // 它才接得住「这句好戳」——而那才是坐在一起听的样子。
          p.nowLyric(),
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

  useEffect(() => {
    if (!base) return;
    let alive = true;
    void likedIds(base).then((s) => alive && setLikes(s));
    return () => {
      alive = false;
    };
  }, [base]);

  const liked = !!t?.songId && likes.has(t.songId);
  const toggleLike = async () => {
    if (!t?.songId || !base) return;
    const want = !liked;
    // ⚠️ **先改样子再发请求，但失败要改回来。** 这颗心是「已经收进
    // 我喜欢的音乐了」的承诺；发失败了还红着，就是骗她。
    setLikes((s) => {
      const n = new Set(s);
      if (want) n.add(t.songId!);
      else n.delete(t.songId!);
      return n;
    });
    setLikeErr(null);
    try {
      await setLiked(base, t.songId, want);
    } catch (e) {
      setLikes((s) => {
        const n = new Set(s);
        if (want) n.delete(t.songId!);
        else n.add(t.songId!);
        return n;
      });
      setLikeErr(e instanceof Error ? e.message : String(e));
    }
  };

  /// 换一首就把歌词收起来。不收的话下一首还摊着上一首的词，
  /// 而且它一句都不会亮——看着像歌词坏了。
  useEffect(() => {
    setShowWords(false);
  }, [t?.songId, t?.id]);

  const cur = p.lines.length ? lineAt(p.lines, p.at) : -1;

  /// 跟着唱到的那句滚。
  ///
  /// ⚠️ **自己算 scrollTop，不要用 `scrollIntoView`。** 它会连带把祖先
  /// 一起滚——播放页本身是 `absolute inset-0` 的一层，被滚一下整页就歪了。
  useEffect(() => {
    const box = scroller.current;
    if (!box || cur < 0) return;
    const el = box.querySelector<HTMLElement>(`[data-line="${cur}"]`);
    if (!el) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
  }, [cur]);

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

      {/* 封面，或者摊开的歌词——**它俩占同一块地方**。
          播放页上最大的那块就该给「现在在听的这首」，歌词来了就换它上台，
          再往下挤只会把两样都挤小。 */}
      {/* ⚠️ **封面这块不吃多余的竖向空间，气泡那块才吃。**
          原来它是 flex-1，于是剩下的空全摊在封面上下，整个画面被推到中间，
          封面看着「浮」在那儿。现在空留给下面，封面、头像、歌名连成一块贴上去。
          摊开歌词时反过来——那时候它是主角，要多高有多高。 */}
      <div className={`${showWords ? "flex-1" : "shrink-0"} min-h-0 px-10 pt-1 grid place-items-center`}>
        {showWords ? (
          <div
            ref={scroller}
            onClick={() => setShowWords(false)}
            className="w-full h-full overflow-y-auto no-bar text-center"
            style={{ maskImage: FADE, WebkitMaskImage: FADE }}
          >
            {/* 上下各垫半屏：第一句和最后一句也能滚到正中间 */}
            <div style={{ height: "42%" }} />
            {p.lines.length ? (
              p.lines.map((l, i) => (
                <p
                  key={`${l.t}-${i}`}
                  data-line={i}
                  className="text-[16px] leading-relaxed py-1.5 transition-all duration-300"
                  style={{
                    color: i === cur ? "var(--ink)" : "var(--ink-faint)",
                    // 唱到的那句放大一点。**只靠颜色不够**——
                    // 背景是从封面取的色，深浅两边的对比度都不一定够。
                    transform: i === cur ? "scale(1.06)" : "scale(1)",
                    fontWeight: i === cur ? 500 : 400,
                  }}
                >
                  {l.text}
                </p>
              ))
            ) : p.plain.length ? (
              <>
                <p className="text-[11px] pb-2" style={{ color: "var(--ink-faint)" }}>
                  这首的歌词没有时间轴，跟不了唱
                </p>
                {p.plain.map((l, i) => (
                  <p key={i} className="text-[15px] leading-relaxed py-1" style={{ color: "var(--ink-dim)" }}>
                    {l}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
                {t.kind === "online" ? "这首没有歌词" : "本地文件没有歌词"}
              </p>
            )}
            <div style={{ height: "42%" }} />
          </div>
        ) : (
          <div
            className="rounded-[26px] overflow-hidden grid place-items-center"
            style={{
              // ⚠️ 上限同时卡宽和高。原来只卡 `62vh`，在高一点的机身上
              // 封面就顶满整屏宽，底下的东西全被挤下去——她说的「太高了」。
              width: "min(100%, 42vh)",
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
        )}
      </div>

      {/* 头像挪到封面下面。原来在封面上头，把最大的那块往下压了一截。
          在这儿它还是「谁和你在这儿」，只是不再跟封面抢最上面那个位置。 */}
      <button
        onClick={() => setInviting(true)}
        className="shrink-0 flex items-center justify-center gap-2 pt-3 active:opacity-60"
      >
        <span className="flex items-center -space-x-2.5">
          <Avatar face={me} size={30} ring />
          {together && <Avatar face={faceOf(together)} size={30} ring />}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {together
            ? `和${displayName(together)}一起听了 ${span(together.together ?? 0)}`
            : "一起听 · 叫上它"}
        </span>
      </button>

      {/* 点这块开歌词。**点字，不是点一个「词」按钮**——
          歌名和歌手本来就是「这首是什么」，歌词是同一件事的展开。 */}
      {/* pt 大一点：歌名整块往下来一点，和封面之间留口气 */}
      <button
        onClick={() => setShowWords((v) => !v)}
        className="shrink-0 px-8 pt-6 text-center w-full active:opacity-60"
      >
        <div className="text-[19px] font-medium truncate" style={{ color: "var(--ink)" }}>
          {t.title}
        </div>
        <div className="text-[13px] truncate mt-0.5" style={{ color: "var(--ink-faint)" }}>
          {t.artist || (t.kind === "online" ? "在线" : "本地文件")}
          <span className="pl-1.5" style={{ opacity: 0.75 }}>
            {showWords ? "· 收起歌词" : "· 点这儿看歌词"}
          </span>
        </div>
        {p.trial && (
          <div className="text-[11px] mt-1" style={{ color: "var(--ink-faint)" }}>
            只有试听片段{p.len > 0 ? ` · ${mmss(p.len)} 就断` : ""}
          </div>
        )}
      </button>

      {/* 气泡。两边都是毛玻璃，只靠左右位置分谁说的——
          她说过两边都白色或者都毛玻璃，那就别用颜色区分。 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto no-bar px-5 pt-3 flex flex-col gap-2 justify-end"
        hidden={showWords}
      >
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

      {/* 进度 + 控制。
          ⚠️ 底下这点留白不是装饰：没有它，播放键会贴着机身最下沿，
          在真手机上正好落在 home 条上，按下去容易误触到系统手势。 */}
      <div className="shrink-0 px-6 pt-3 pb-5">
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
        <div className="flex items-center justify-center gap-6 pt-2">
          {/* 喜欢。**只有在线的歌才有**——本地文件没有 songId，
              网易云那边也就无从收起。 */}
          <button
            onClick={() => void toggleLike()}
            disabled={!t.songId || !base}
            className="active:opacity-50 disabled:opacity-25"
            aria-label={liked ? "取消喜欢" : "喜欢"}
          >
            <svg viewBox="0 0 24 24" width="23" height="23"
              fill={liked ? "oklch(0.62 0.21 20)" : "none"}
              stroke={liked ? "oklch(0.62 0.21 20)" : "var(--ink-dim)"}
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20.4 3.9 12.3a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l1.1 1.1 1.1-1.1a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7z" />
            </svg>
          </button>
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
          {/* 待播清单 */}
          <button onClick={() => setQueueOpen(true)} className="active:opacity-50" aria-label="待播清单">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="var(--ink-dim)"
              strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
        </div>
        {likeErr && (
          <p className="text-center text-[11px] pt-1.5" style={{ color: "oklch(0.65 0.19 25)" }}>
            {likeErr}
          </p>
        )}
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

      {inviting && (
        <TogetherSheet
          settings={settings}
          contacts={allContacts}
          track={t}
          onDone={(id) => {
            onChange({ togetherWith: id });
            if (!id) setInviting(false);
          }}
          onClose={() => setInviting(false)}
        />
      )}

      {queueOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end">
          <button aria-label="关掉" onClick={() => setQueueOpen(false)} className="absolute inset-0"
            style={{ background: "oklch(0 0 0 / 0.45)" }} />
          <div className="glass-strong relative rounded-t-[28px] px-4 pt-4 pb-6 max-h-[70%] flex flex-col">
            <div className="w-9 h-1 rounded-full mx-auto mb-3 shrink-0"
              style={{ background: "var(--ink)", opacity: 0.2 }} />
            <div className="shrink-0 px-1 pb-2">
              <div className="text-[15px]" style={{ color: "var(--ink)" }}>
                待播清单
              </div>
              {/* ⚠️ 说清它和歌单不是一回事。两个都叫「一列歌」，
                  不写明白的话，删掉一首会被当成把歌从网易云歌单里删了。 */}
              <div className="text-[11px] pt-0.5" style={{ color: "var(--ink-faint)" }}>
                {p.queue.length} 首 · 这是现在排着要放的，不是你的歌单——在这儿删不动网易云那边
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto no-bar">
              {p.queue.map((q, i) => {
                const on = q.id === t.id;
                return (
                  <div key={q.id} className="flex items-center gap-2 px-1 py-2">
                    <button
                      onClick={() => p.play(q, p.queue)}
                      className="min-w-0 flex-1 text-left active:opacity-60"
                    >
                      <span className="block text-[13.5px] truncate" style={{ color: "var(--ink)" }}>
                        {on ? "▸ " : ""}
                        {q.title}
                      </span>
                      <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                        {q.artist || (q.kind === "online" ? "在线" : "本地文件")}
                      </span>
                    </button>
                    {/* ⚠️ **上下箭头，不做拖拽排序。** 这个盒子本身在滚，
                        拖拽要和它抢同一个手势——桌面那边为这件事查了五轮。
                        箭头难看一点，但按下去一定是它。 */}
                    <button onClick={() => p.moveTo(i, i - 1)} disabled={i === 0}
                      className="px-1.5 text-[15px] disabled:opacity-20 active:opacity-50"
                      style={{ color: "var(--ink-faint)" }} aria-label="往上挪">
                      ↑
                    </button>
                    <button onClick={() => p.moveTo(i, i + 1)} disabled={i === p.queue.length - 1}
                      className="px-1.5 text-[15px] disabled:opacity-20 active:opacity-50"
                      style={{ color: "var(--ink-faint)" }} aria-label="往下挪">
                      ↓
                    </button>
                    <button onClick={() => p.dropAt(i)}
                      className="px-1.5 text-[13px] active:opacity-50"
                      style={{ color: "var(--ink-faint)" }} aria-label="移出清单">
                      ✕
                    </button>
                  </div>
                );
              })}
              {p.queue.length === 0 && (
                <p className="text-center text-[12px] py-8" style={{ color: "var(--ink-faint)" }}>
                  清单是空的。
                </p>
              )}
            </div>
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

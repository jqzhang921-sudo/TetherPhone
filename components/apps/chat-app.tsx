"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { loadMsgs, saveMsgs, newId, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import { dayLabel, loadDiary, type DiaryEntry } from "@/lib/diary/store";
import {
  MAX_PER_MESSAGE,
  blankPhoto,
  deletePhoto,
  loadPhotos,
  savePhoto,
  shrink,
  toDataUrl,
  type Photo,
} from "@/lib/photos/store";
import { TOOLS, lockedPages, runTool, toolRules } from "@/lib/tools";
import { digest, loadMemory, type MemoryTopic } from "@/lib/memory/store";
import { boardText, loadNotes, type Note } from "@/lib/notes/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import { useBlobUrl } from "@/lib/use-blob-url";
import { usePlayer } from "@/components/phone/player";
import { PHONE, loadTracks, saveTrack, search as searchSongs } from "@/lib/music/store";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "@/components/phone/avatar";
import { faceOf } from "@/lib/os/avatar";
import { bubbleById } from "@/lib/os/bubbles";
import { useChatSkin } from "@/lib/os/chat-bg";
import { StatusBar } from "@/components/phone/status-bar";

/// 发给上游的消息。比库里存的 Msg 多两样：assistant 可能带 tool_calls，
/// tool 角色要带 tool_call_id。
type ApiMsg = {
  role: string;
  content: string | unknown[] | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

function systemPrompt(
  c: Contact,
  me: Settings,
  shared: DiaryEntry[],
  locked: string,
  mem: MemoryTopic[],
  notes: Note[],
  /// 上一条消息的时刻。null = 还没说过话。
  lastAt: number | null,
) {
  const bits: string[] = [];
  if (c.name.trim()) bits.push(`你叫${c.name.trim()}。`);
  if (me.userName.trim()) bits.push(`跟你说话的人叫${me.userName.trim()}。`);
  if (c.persona.trim()) bits.push(c.persona.trim());
  // 只给名字，不挂形容词——挂了模型就去演那个词。

  // 能看到的只有**公开的**日记。私密那些一个字都不进来——
  // 这是整个交换日记机制的地基，漏了就什么都不成立。
  const open = shared.filter((e) => !e.secret).slice(0, 3);
  if (open.length) {
    bits.push(
      "下面是日记本里对你公开的几篇。不用主动提起，除非她说到：\n" +
        open
          .map((e) => `【${dayLabel(e.at)}·${e.author === "me" ? "她写的" : "你写的"}】${e.text.slice(0, 400)}`)
          .join("\n"),
    );
  }

  // ⚠️ **注册了工具 ≠ 它会用。** 工具描述只回答「怎么用」，不回答「现在该不该用」——
  // 什么时候该开一页日记，必须另写一段规矩。这条在 phone-ai-assistant 里
  // 反复踩过（remember 那几个、follow_up_later 都一样）。
  // 记忆的**摘要**常驻。细节不进——那是 open_memory 的活儿。
  // 顺序按「多久变一次」排：名字 → 人设 → 记忆 → 规矩 → 锁着的页，
  // 越靠前越稳定，KV 缓存才吃得住。
  const d = digest(mem);
  if (d) bits.push(d);

  // 板是公用的，它该知道上面有什么。**但知道 ≠ 该开口提**——
  // 复述她自己写的待办就是催，那条规矩在 toolRules 里。
  const board = boardText(notes);
  if (board) bits.push(board);

  bits.push(toolRules);
  // 它锁着的那几页。不给它看的话，它根本不知道有东西可开。
  if (locked) bits.push(locked);

  // ⚠️ **时间必须放在最后一段。** 它每条消息都变，放前面会把前面所有内容的
  // 前缀缓存整段打散——名字、人设、记忆、规矩全部重算。放末尾只作废它自己。
  //
  // ⚠️ 时间**不进消息正文**。给每条前面贴 `[14:32]` 的话，模型会学着也这么写，
  // 时间戳就漏进它说的话里了。它真正需要的只有两件事：现在几点、
  // 距上次说话隔了多久。
  bits.push(nowLine(lastAt));

  return bits.join("\n");
}

/// 「现在几点」那一段。
///
/// **隔了多久比几点几分更有用**：模型据此才分得清「刚说完」和「昨天说的」。
function nowLine(lastAt: number | null): string {
  const now = new Date();
  const w = "日一二三四五六"[now.getDay()];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const bits = [
    `现在是 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${w} ${hh}:${mm}。`,
  ];
  if (lastAt) {
    const min = Math.round((Date.now() - lastAt) / 60000);
    const gap =
      min < 2
        ? "刚刚"
        : min < 60
          ? `${min} 分钟前`
          : min < 60 * 24
            ? `${Math.round(min / 60)} 小时前`
            : `${Math.round(min / 60 / 24)} 天前`;
    bits.push(`你们上一次说话是${gap}。`);
  }
  // 时间是背景，不是话题。不写这句它会张口就报时。
  bits.push("知道时间是为了说话合时宜，不是为了报时——除非她问，别把时间说出来。");
  return bits.join("");
}

const clock = (at: number) => {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/// 两条之间要不要插一条分隔，插什么。
///
/// **只在真的断开时插。** 每条都写日期就成了流水账，而分隔的意义正是
/// 「这里断过」：换了一天，或者中间隔了半小时以上。
function gapLabel(prev: number | undefined, at: number): string | null {
  const d = new Date(at);
  const day = `${d.getMonth() + 1}月${d.getDate()}日`;
  const hm = clock(at);
  if (prev === undefined) return `${day} ${hm}`;
  const p = new Date(prev);
  if (p.toDateString() !== d.toDateString()) return `${day} ${hm}`;
  return at - prev >= 30 * 60_000 ? hm : null;
}

/// 待发区的一张。发送前还没落库，所以直接拿 Blob 显示。
function PendingThumb({ blob, onDrop }: { blob: Blob; onDrop: () => void }) {
  const url = useBlobUrl(blob);
  return (
    <span className="relative shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url ?? undefined} alt="" className="w-14 h-14 rounded-xl object-cover" />
      <button
        onClick={onDrop}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full grid place-items-center text-[11px]"
        style={{ background: "oklch(0.25 0 0 / 0.8)", color: "oklch(0.98 0 0)" }}
        aria-label="去掉这张"
      >
        ✕
      </button>
    </span>
  );
}

export function ChatApp({
  contacts,
  settings,
  onOpenProfile,
  onAddContact,
  openWith,
}: {
  contacts: Contact[];
  settings: Settings;
  onOpenProfile: (c: Contact) => void;
  /// 通讯录并进来了：**列表就是通讯录**，所以新建也归这儿。
  onAddContact: () => void;
  /// 从主页「发消息」进来时，直接开这个人的会话，别把人扔回列表让他再点一次。
  openWith?: string | null;
}) {
  const bubble = bubbleById(settings.bubbleStyle);
  /// 聊天页的宽高比，算背景下限要按 cover 裁过再取样。量一次就够。
  /// ⚠️ 用 offsetWidth 不用 getBoundingClientRect——app 打开动画起手是
  /// scale(0.16)，rect 返回的是变换后的尺寸。
  const [aspect, setAspect] = useState(9 / 19.5);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el?.offsetHeight) setAspect(el.offsetWidth / el.offsetHeight);
  }, []);
  const [openId, setOpenId] = useState<string | null>(openWith ?? null);
  useEffect(() => {
    if (openWith) setOpenId(openWith);
  }, [openWith]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [memory, setMemory] = useState<MemoryTopic[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [pending, setPending] = useState<{ blob: Blob; w: number; h: number }[]>([]);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const player = usePlayer();

  const contact = contacts.find((c) => c.id === openId) ?? null;
  /// 这段关系自己的聊天背景。没开会话时 openId 是 null，传空串——
  /// hook 不能写在提前 return 后面，所以它总要被调用一次。
  const skin = useChatSkin(openId ?? "", contact?.chatBgAt, aspect);

  const refreshPhotos = useCallback(async (cid: string) => {
    const rows = await loadPhotos(cid);
    setPhotos(Object.fromEntries(rows.map((p) => [p.id, p])));
  }, []);

  // 会话列表要显示每段对话的最后一句
  useEffect(() => {
    if (openId) return;
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const c of contacts) {
        const rows = await loadMsgs(c.id);
        const last = rows.at(-1);
        out[c.id] = last ? (last.content.slice(0, 24) || (last.photoIds?.length ? "[图片]" : "")) : "";
      }
      if (alive) setPreviews(out);
    })();
    return () => {
      alive = false;
    };
  }, [openId, contacts]);

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    void loadMsgs(openId).then((rows) => alive && setMsgs(rows));
    void loadDiary(openId).then((rows) => alive && setDiary(rows));
    void loadMemory(openId).then((rows) => alive && setMemory(rows));
    void loadNotes(openId).then((rows) => alive && setNotes(rows));
    void refreshPhotos(openId);
    return () => {
      alive = false;
    };
  }, [openId, refreshPhotos]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy, pending]);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    const room = MAX_PER_MESSAGE - pending.length;
    if (room <= 0) return setErr(`一条最多 ${MAX_PER_MESSAGE} 张`);
    const take = Array.from(files).slice(0, room);
    try {
      // 压缩在选完的时候做，不是发送的时候——发送要等的话，
      // 六张图会让「发送」按下去之后卡住一两秒，看着像没反应。
      const done = await Promise.all(take.map((f) => shrink(f)));
      setPending((p) => [...p, ...done]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const send = useCallback(async () => {
    const body = text.trim();
    if ((!body && !pending.length) || busy || !contact) return;
    if (!settings.apiKey) {
      setErr("还没填 API key。回桌面打开「设置」。");
      return;
    }
    setErr(null);

    // 图先落库拿到 id，消息只存 id
    const shots: Photo[] = pending.map((p) => ({
      ...blankPhoto(contact.id, "me"),
      blob: p.blob,
      w: p.w,
      h: p.h,
    }));
    for (const s of shots) await savePhoto(s);

    const mine: Msg = {
      id: newId(),
      contactId: contact.id,
      role: "user",
      content: body,
      photoIds: shots.length ? shots.map((s) => s.id) : undefined,
      at: Date.now(),
    };
    const history = [...msgs, mine];
    setMsgs(history);
    void saveMsgs([mine]);
    setPending([]);
    setText("");
    setBusy(true);
    if (shots.length) void refreshPhotos(contact.id);

    try {
      // 带图的那条按 OpenAI 多模态格式发。**不猜模型能不能看图**——
      // 按名字猜能力是错的，会把图悄悄丢掉且查不出原因。发过去让上游说话。
      const convo: ApiMsg[] = await Promise.all(
        history
          .filter((m) => m.role !== "event")
          .map(async (m): Promise<ApiMsg> => {
            const ids = m.photoIds ?? [];
            if (!ids.length) return { role: m.role, content: m.content };
            const parts: unknown[] = [];
            // ⚠️ 没打字发图时**不要**替她编一句「分析这张图片」。
            // 那一句会让它去做图像分析，而不是像收到一张照片那样说话。
            if (m.content.trim()) parts.push({ type: "text", text: m.content });
            for (const id of ids) {
              const p = photos[id] ?? shots.find((s) => s.id === id);
              if (!p) continue;
              parts.push({ type: "image_url", image_url: { url: await toDataUrl(p.blob) } });
            }
            return { role: m.role, content: parts };
          }),
      );

      const sys = systemPrompt(
        contact,
        settings,
        diary,
        await lockedPages(contact.id),
        memory,
        notes,
        // 「上一次说话」= 这次她开口之前的最后一条，不是刚发出去这条
        msgs.at(-1)?.at ?? null,
      );
      const replyId = newId();
      let visible = "";

      // 工具轮次。**封三轮是保险丝**：模型偶尔会陷进「调用 → 看结果 → 再调用」
      // 的圈里，没有上限就一直烧钱。
      for (let round = 0; round < 3; round++) {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiBase: settings.apiBase,
            apiKey: settings.apiKey,
            model: contact.model.trim() || settings.model,
            system: sys,
            messages: convo,
            tools: TOOLS,
          }),
        });
        if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        // ⚠️ 跨分片缓冲。SSE 的一行经常被切在两个网络分片里，按分片切行会把
        // 被切开的那行两半都丢掉——症状是长回复零星掉字，不是尾部截断。
        let buf = "";
        let said = "";
        // ⚠️ **工具调用的参数是一片一片来的**，要按 index 拼起来。
        // 对每个分片单独 JSON.parse 必然失败——这是接 function calling
        // 最容易踩的一脚，而且症状是"工具从来不触发"，看不出是解析问题。
        const calls: { id: string; name: string; args: string }[] = [];

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const chunk = t.slice(5).trim();
            if (chunk === "[DONE]") continue;
            try {
              const delta = JSON.parse(chunk)?.choices?.[0]?.delta;
              if (typeof delta?.content === "string" && delta.content) {
                said += delta.content;
                const shown = visible + said;
                setMsgs((prev) => [
                  ...prev.filter((m) => m.id !== replyId),
                  {
                    id: replyId,
                    contactId: contact.id,
                    role: "assistant" as const,
                    content: shown,
                    at: Date.now(),
                  },
                ]);
              }
              for (const tc of delta?.tool_calls ?? []) {
                const i = tc.index ?? 0;
                calls[i] ??= { id: "", name: "", args: "" };
                if (tc.id) calls[i].id = tc.id;
                if (tc.function?.name) calls[i].name = tc.function.name;
                if (tc.function?.arguments) calls[i].args += tc.function.arguments;
              }
            } catch {
              // 单个分片解析不了就跳过这一行，别让整条流断掉
            }
          }
        }

        visible += said;
        const wanted = calls.filter((c) => c?.name);
        if (!wanted.length) break;

        convo.push({
          role: "assistant",
          content: said || null,
          tool_calls: wanted.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.args },
          })),
        });

        for (const c of wanted) {
          const out = await runTool(c.name, c.args, {
            contact,
            // 播放器在壳里，工具层碰不到——这里把「怎么放歌」注入进去。
            playSong: settings.musicApiBase.trim()
              ? async (kw: string) => {
                  const hits = await searchSongs(settings.musicApiBase.trim(), kw);
                  // 优先挑能完整听的。**挑到只有试听的等于没放**——
                  // 她按下去听 30 秒就断，那不是放歌是添堵。
                  const pick = hits.find((h) => !h.vip) ?? hits[0];
                  if (!pick) return `没搜到「${kw}」。`;
                  const t = {
                    id: newId(),
                    contactId: PHONE,
                    kind: "online" as const,
                    title: pick.title,
                    artist: pick.artist,
                    songId: pick.songId,
                    cover: pick.cover,
                    at: Date.now(),
                  };
                  await saveTrack(t);
                  player.play(t, await loadTracks());
                  return pick.vip
                    ? `放了《${pick.title}》，但这首只有试听片段。`
                    : `放了《${pick.title}》- ${pick.artist}。`;
                }
              : undefined,
            refresh: async () => {
              setDiary(await loadDiary(contact.id));
              setMemory(await loadMemory(contact.id));
              setNotes(await loadNotes(contact.id));
            },
          });
          // 结果原样回给它。**失败也要说清楚**——静默失败会让它以为成功了。
          convo.push({ role: "tool", tool_call_id: c.id, content: out });
        }
      }

      if (visible.trim()) {
        await saveMsgs([
          { id: replyId, contactId: contact.id, role: "assistant", content: visible, at: Date.now() },
        ]);
      }
      // 工具可能往对话里插了 event 行，重新读一遍才看得到
      setMsgs(await loadMsgs(contact.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs(history);
    } finally {
      setBusy(false);
    }
  }, [text, pending, busy, contact, msgs, settings, diary, memory, notes, photos, refreshPhotos]);

  // ── 会话列表 ────────────────────────────────────────────────
  if (!contact) {
    return (
      <div
        className="w-full h-full flex flex-col"
        style={{
          paddingBottom: "var(--home-h)",
          // 满屏的 app 自己画纸面——AppWindow 对 bleed 是不画的
          background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
          backdropFilter: "blur(28px) saturate(1.5)",
          WebkitBackdropFilter: "blur(28px) saturate(1.5)",
        }}
      >
        <StatusBar />
        {/* ⚠️ **通讯录没了，这张列表就是通讯录。** 两个 app 列的是同一批人、
            点进去做的是同一件事，分成两个只是让人多记一个入口。
            所以新建也归这儿；点头像进主页，点别处进会话。 */}
        <header className="px-5 pt-1 pb-3 shrink-0 flex items-center justify-between">
          <h1 className="text-[26px] font-semibold" style={{ color: "var(--ink)" }}>
            聊天
          </h1>
          <button
            onClick={onAddContact}
            aria-label="新建联系人"
            className="w-9 h-9 rounded-full grid place-items-center active:scale-90 transition-transform"
            style={{ background: "color-mix(in oklab, var(--ink) 8%, transparent)" }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--ink)"
              strokeWidth="1.9" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-4">
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className="w-full flex items-center gap-3 px-2 py-3 text-left active:opacity-60"
            >
              {/* 点头像进主页，点别处进会话——和真手机一样 */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProfile(c);
                }}
              >
                <Avatar face={faceOf(c)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] truncate" style={{ color: "var(--ink)" }}>
                  {displayName(c)}
                </span>
                <span className="block text-[13px] truncate mt-0.5" style={{ color: "var(--ink-faint)" }}>
                  {previews[c.id] || "还没说过话"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── 聊天室 ──────────────────────────────────────────────────
  return (
    <div
      ref={measure}
      className="w-full h-full flex flex-col"
      // ⚠️ **整片跟着背景图翻深浅。** 浅色壁纸配一张深色聊天背景，
      // 不翻的话就是深底深字；或者为了让深字读得了，把玻璃逼到厚成一块白板。
      // globals.css 里那套 token 是按 [data-tone] 挂的、不绑在 .device 上，
      // 所以挂在这儿就只影响聊天页。
      data-tone={skin ? (skin.dark ? "dark" : "light") : undefined}
      style={{
        // 状态栏排在这一列里（见下面第一个子元素），所以顶上不用留白；
        // home 条是浮着的，底下得让开，否则输入框被压住点不到。
        paddingBottom: "var(--home-h)",
        ...(skin
          ? {
              backgroundImage: `url(${skin.url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              color: "var(--ink)",
              // 这张背景算出来的玻璃下限。半透明的气泡和输入框靠 max() 吃它——
              // 设备那一层是按**壁纸**算的，管不到铺了背景图的聊天页。
              ["--glass-floor" as string]: `${Math.round(skin.floor * 100)}%`,
              ["--glass-floor-strong" as string]: `${Math.min(92, Math.round(skin.floor * 100) + 16)}%`,
            }
          : {
              // 没设背景就还是原来那张纸
              background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
              backdropFilter: "blur(28px) saturate(1.5)",
              WebkitBackdropFilter: "blur(28px) saturate(1.5)",
            }),
      }}
    >
      {/* 自己画状态栏：这一层的 data-tone 跟着背景图翻，画在这儿它才跟着翻 */}
      <StatusBar />
      <header className="shrink-0 flex items-center gap-2 px-3 pt-1 pb-2.5">
        <button onClick={() => setOpenId(null)} className="p-1.5 -ml-1 active:opacity-50" aria-label="返回">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--ink)"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        {/* 点头像进主页——个性签名、号码、以后的朋友圈都在那儿 */}
        <button onClick={() => onOpenProfile(contact)} className="flex items-center gap-2.5 active:opacity-60">
          <Avatar face={faceOf(contact)} size={32} />
          <span className="text-[16px] font-medium" style={{ color: "var(--ink)" }}>
            {displayName(contact)}
          </span>
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-2 flex flex-col gap-2.5">
        {msgs.length === 0 && !busy && (
          <div className="flex-1 grid place-items-center px-8">
            <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
              还没有说过话。
            </p>
          </div>
        )}

        {msgs.map((m, i) => (
          <Fragment key={m.id}>
            {/* 跨天 / 隔了很久，插一条居中的分隔。**只在真的断开时插**——
                每条都写日期就成了流水账，而分隔的意义正是「这里断过」。 */}
            {gapLabel(msgs[i - 1]?.at, m.at) && (
              <div
                className="self-center px-4 py-1 text-[11px]"
                style={{ color: "var(--ink-faint)" }}
              >
                {gapLabel(msgs[i - 1]?.at, m.at)}
              </div>
            )}
            {m.role === "event" ? (
              // 它没开口，只是有件事发生了。样式刻意和分隔线同一档。
              <div
                className="self-center px-6 py-1 text-[11px] text-center leading-relaxed"
                style={{ color: "var(--ink-faint)" }}
              >
                {m.content}
              </div>
            ) : (
              <div
                className={`max-w-[78%] flex flex-col gap-1.5 ${
                  m.role === "user" ? "self-end items-end" : "self-start items-start"
                }`}
              >
                {!!m.photoIds?.length && (
                  <div className={`grid gap-1 ${m.photoIds.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {m.photoIds.map((id) => (
                      <button key={id} onClick={() => photos[id] && setViewing(photos[id])}>
                        <PhotoImg
                          photo={photos[id]}
                          className="rounded-[14px] object-cover w-full"
                          style={{
                            maxHeight: m.photoIds!.length > 1 ? 110 : 210,
                            aspectRatio: m.photoIds!.length > 1 ? "1 / 1" : undefined,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                )}
                {!!m.content && (
                  <div
                    className="px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
                    // 样式在 lib/os/bubbles.ts。每套都自己立住底，不靠透出壁纸成立。
                    //
                    // ⚠️ **说话那侧的下角收紧到 6px。** 四角全 20 的话，
                    // 两三个字的消息宽高都只有四十来像素，20 就是它的半高——
                    // 圆角互相接上，气泡变成一颗药丸；描边那套最明显，像个按钮。
                    // 缺一个角既压住了这个形状，又顺带指出话是从哪边出来的。
                    style={{
                      borderRadius: m.role === "user" ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
                      ...(m.role === "user" ? bubble.me(contact.bubble) : bubble.them),
                    }}
                  >
                    {m.content}
                  </div>
                )}
                {/* 发出去的时刻。挂在气泡外面、贴着说话那一侧——
                    写进气泡里就成了正文的一部分，模型也会跟着学。 */}
                <span className="text-[10px] px-1 -mt-0.5" style={{ color: "var(--ink-faint)" }}>
                  {clock(m.at)}
                </span>
              </div>
            )}
          </Fragment>
        ))}

        {busy && (
          <div className="self-start px-3.5 py-3"
            style={{ borderRadius: "20px 20px 20px 6px", ...bubble.them }}>
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--ink-faint)", animationDelay: `${i * 160}ms` }} />
              ))}
            </span>
          </div>
        )}

        {err && (
          <div className="self-center text-[12px] text-center px-4 py-2 rounded-xl"
            style={{ color: "oklch(0.65 0.19 25)", background: "oklch(0.65 0.19 25 / 0.12)" }}>
            {err}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* 待发区。选完不立刻发——挑错了能一张张叉掉 */}
      {!!pending.length && (
        <div className="shrink-0 flex gap-2 px-4 pb-1 pt-1 overflow-x-auto no-bar">
          {pending.map((p, i) => (
            <PendingThumb
              key={i}
              blob={p.blob}
              onDrop={() => setPending((cur) => cur.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      <div className="shrink-0 px-3 pb-1 pt-2">
        <div className="glass-strong rounded-[24px] flex items-end gap-2 px-3 py-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="shrink-0 w-8 h-8 grid place-items-center active:opacity-50"
            aria-label="发图片"
          >
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="var(--ink-dim)"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <circle cx="8.5" cy="10" r="1.4" />
              <path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 21" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="说点什么"
            className="flex-1 bg-transparent outline-none resize-none text-[15px] max-h-28 py-1.5"
            style={{ color: "var(--ink)" }}
          />
          <button
            onClick={() => void send()}
            disabled={busy || (!text.trim() && !pending.length)}
            className="shrink-0 w-9 h-9 rounded-full grid place-items-center disabled:opacity-30 transition-opacity"
            style={{ background: contact.bubble, color: "oklch(0.99 0 0)" }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      {viewing && (
        <PhotoViewer
          photo={viewing}
          onClose={() => setViewing(null)}
          onSave={
            viewing.saved
              ? undefined
              : async () => {
                  await savePhoto({ ...viewing, saved: true });
                  await refreshPhotos(contact.id);
                  setViewing(null);
                }
          }
          onDelete={async () => {
            await deletePhoto(viewing.id);
            await refreshPhotos(contact.id);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

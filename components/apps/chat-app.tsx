"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { loadMsgs, revealed, saveMsgs, newId, type Msg, type Share } from "@/lib/chat/store";
import { get } from "@/lib/db/idb";
import { haptic } from "@/lib/os/haptic";
import { liveStatus, myStatus, statusLabel, statusLine } from "@/lib/os/status";
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
import { timeAgo } from "@/lib/moments/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import { useBlobUrl } from "@/lib/use-blob-url";
import { usePlayer } from "@/components/phone/player";
import { PHONE, loadTracks, saveTrack, search as searchSongs } from "@/lib/music/store";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "@/components/phone/avatar";
import { faceOf, useMe } from "@/lib/os/avatar";
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
  /// 现在正在放什么、唱到哪。没在放就是空串。
  playing: string,
  /// 两个人的状态、留了还没解封的那句、「她在说晚安」的提醒。没有就是空串
  mood: string,
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
  //
  // 「在放什么」跟在时间后面，理由同上：它也是每条都在变的那一类。
  bits.push(nowLine(lastAt));
  if (playing) bits.push(playing);
  if (mood) bits.push(mood);

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

/// 它先开口时，additional 到系统提示词末尾的一段。
///
/// ⚠️ **红线：带来一件东西，不索取。** 这是 Cleo 早就定过的——
/// 「在吗」「想你了」「最近怎么样」都是索取：它们要的是她的回应，
/// 而她打开手机的那一刻并不欠任何人一个回应。
///
/// ⚠️ **必须给它一条「什么都不说」的出口，而且要好走。**
/// 没有出口的话，模型面对「现在该说点什么」永远会说点什么——
/// 于是每次开 app 都被打招呼，主动就退化成了骚扰。
/// 模型又不擅长输出空字符串，所以约定一个记号：只回一个减号。
const OPEN_RULE = [
  "",
  "——",
  "她刚打开这个对话，隔了一段时间没说话了。你**可以**先开口，但只在一种情况下：",
  "你确实带来了一件东西。一封写好的信、一首想放给她的歌、一件你查到并且跟她有关的事、",
  "一页你写了想给她看的日记。带来的东西要具体到能指认，不是一种心情。",
  "",
  "**「在吗」「想你了」「最近怎么样」这些不算。** 它们要的是她的回应——",
  "而她刚打开手机，不欠任何人一个回应。",
  "",
  "没有要带来的，就**只回一个减号 `-`**，别的一个字都不要写。沉默不是失败，是常态。",
].join("\n");

/// 「我没有要说的」。宽一点：不同模型会回 `-`、`—`、`- `、`。`。
const PASS = /^[-—–.。\s]{0,3}$/;

/// 她拍了拍它之后，接不接由它。
///
/// ⚠️ **拍一拍要给「不接」留出口，而且要比先开口那条还好走。** 拍是随手的，
/// 每拍一下它都正经回一句，拍两下就成了在按门铃。
const PAT_RULE = [
  "",
  "——",
  "她刚拍了拍你（聊天里是一行小字，不是一句话）。",
  "可以回一句、可以拍回去（pat_back），也可以什么都不做——那就只回一个减号 `-`，别的一个字都不要写。",
].join("\n");

/// 她是不是在说晚安。宽一点：「我先睡了」「困了去睡」「gn」都算。
/// 认错了也不要紧——命中之后只是**提醒它可以留一句**，留不留还是它自己定。
const GOODNIGHT = /晚安|睡了|去睡|睡觉|睡啦|先睡|困了|good\s*night|\bgn\b/i;

/// 明早那句几点解封：**说晚安之后至少三小时**，而且落在早上。
/// 23 点说 → 次日 5 点；凌晨 1 点半说 → 当天 5 点；凌晨 3 点说 → 6 点（不能拖到第二天）；
/// 晚上 8 点说 → 次日 5 点。⚠️ 不按「明天」算：凌晨说的晚安，「明天」已经是后天了。
function morningAfter(at: number) {
  const earliest = at + 3 * 3600_000;
  const five = new Date(earliest);
  five.setHours(5, 0, 0, 0);
  if (new Date(earliest).getHours() < 12) return Math.max(earliest, five.getTime());
  five.setDate(five.getDate() + 1);
  return five.getTime();
}

/// 隔多久才给它一次先开口的机会。
///
/// ⚠️ **门槛是「隔了多久」，不是「到点了」。** 定时推送是她明确否掉的那种
/// ——出口不是排班表。挂在「她打开一段久没说话的对话」上，
/// 主动才是接着上一次，而不是凭空插进她的一天。
const GREET_GAP = 3 * 60 * 60_000;

const clock = (at: number) => {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/// 转发来的动态，写成给模型读的一段。
///
/// ⚠️ **「谁发的」必须说清。** 把 A 的动态转给 B，B 要是以为那是她写的、
/// 或者以为是自己写的，它接下来的话就全错了位。
function shareText(s: Share): string {
  const who =
    s.by === "her"
      ? "她转发了自己发的一条动态"
      : s.by === "you"
        ? "她把你发过的一条动态转回给你"
        : `她转发了${s.byName}发的一条动态`;
  const body = s.text.trim() || (s.photoIds?.length ? "（只有图，没有字）" : "");
  return `[${who}，${timeAgo(s.at)}发的]\n${body}`;
}

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
  onGreeted,
  openWith,
  onSetContactStatus,
}: {
  contacts: Contact[];
  settings: Settings;
  onOpenProfile: (c: Contact | "me") => void;
  /// 通讯录并进来了：**列表就是通讯录**，所以新建也归这儿。
  onAddContact: () => void;
  /// 记下它「先开口」过了，防同一段沉默里反复打招呼
  onGreeted: (id: string) => void;
  /// 从主页「发消息」进来时，直接开这个人的会话，别把人扔回列表让他再点一次。
  openWith?: string | null;
  /// 它改了自己的状态。状态挂在联系人身上，联系人归外层管，这里只报上去
  onSetContactStatus: (id: string, status: Contact["status"]) => void;
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
        // 明早才解封的那句不能提前出现在列表的预览里
        const last = [...rows].reverse().find((m) => revealed(m));
        out[c.id] = last
          ? last.content.slice(0, 24) ||
            (last.share ? "[转发了一条动态]" : last.photoIds?.length ? "[图片]" : "")
          : "";
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

  /// 转发来的动态里的图。
  ///
  /// ⚠️ **它们不在这个联系人的相册范围里**（原帖可能在另一个联系人那页上），
  /// `loadPhotos(openId)` 拿不到，得按 id 单独取。另存一份，免得 refreshPhotos
  /// 整张换掉时被冲走。取过的 id 记下来：原图被删了取不到的话，
  /// 不记就会一遍遍重取，effect 自己转成死循环。
  const [sharePhotos, setSharePhotos] = useState<Record<string, Photo>>({});
  const triedShare = useRef(new Set<string>());
  useEffect(() => {
    const want = [...new Set(msgs.flatMap((m) => m.share?.photoIds ?? []))].filter(
      (id) => !photos[id] && !triedShare.current.has(id),
    );
    if (!want.length) return;
    want.forEach((id) => triedShare.current.add(id));
    let alive = true;
    void Promise.all(want.map((id) => get<Photo>("photos", id))).then((rows) => {
      const found = rows.filter((r): r is Photo => !!r);
      if (!alive || !found.length) return;
      setSharePhotos((prev) => ({ ...prev, ...Object.fromEntries(found.map((r) => [r.id, r])) }));
    });
    return () => {
      alive = false;
    };
  }, [msgs, photos]);

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

  /// `first = true` 时它先开口：不造用户消息，只让它看着已有的对话说一句。
  /// 她打开一段久没说话的对话时，给它一次先开口的机会。
  ///
  /// ⚠️ **不是定时器。** 挂在「打开」上，所以它开口永远是接着上一次，
  /// 而不是凭空插进她的一天。真正决定说不说的是模型自己——
  /// 没东西可带就回一个减号，那条消息不会落库（见 OPEN_RULE / PASS）。
  const greeting = useRef(false);
  useEffect(() => {
    if (!settings.proactive || !contact || busy || greeting.current) return;
    if (!settings.apiKey.trim()) return;
    const last = [...msgs].reverse().find((m) => revealed(m));
    if (!last) return;
    if (Date.now() - last.at < GREET_GAP) return;
    // 同一段沉默里只开口一次
    if ((contact.greetedAt ?? 0) >= last.at) return;
    greeting.current = true;
    onGreeted(contact.id);
    void sendRef.current?.(true).finally(() => {
      greeting.current = false;
    });
  }, [contact, msgs, busy, settings.proactive, settings.apiKey, onGreeted]);

  /// 她转发过来、还没人接的那条动态：打开聊天就接一句。
  ///
  /// ⚠️ **转发不是留言，是递过去一样东西。** 递过去没反应，看着就像没发到。
  /// 这**不走 OPEN_RULE**：不是它主动开口，是回应她递过来的东西。
  /// 每条只接一次（replied 记着），失败也不在这次打开里重试——
  /// 不然打开一次聊天就刷出一串请求。
  const replied = useRef<string | null>(null);
  useEffect(() => {
    if (!contact || busy || greeting.current) return;
    if (!settings.apiKey.trim()) return;
    const last = [...msgs].reverse().find((m) => m.role !== "event" && revealed(m));
    if (!last?.share || last.role !== "user" || last.contactId !== contact.id) return;
    if (replied.current === last.id) return;
    replied.current = last.id;
    void sendRef.current?.(false, "share");
  }, [contact, msgs, busy, settings.apiKey]);

  /// 拍一拍之后「等她拍完再问它」的那个定时器。放在 send 前面：她拍完又开口说话，
  /// 那句话本身就会得到回复，send 要能把这个定时器掐掉，别再为拍一拍另问一次。
  const patTimer = useRef<number | null>(null);

  /// `reply`：她这边没有新消息，只让它对已经在对话里的东西接一句。
  /// "share" = 她转来的动态；"pat" = 她拍了拍它（带 PAT_RULE，允许回一个减号不接）。
  /// 和 first 的区别是不带 OPEN_RULE。
  const send = useCallback(async (first = false, reply: false | "share" | "pat" = false) => {
    const body = first || reply ? "" : text.trim();
    if (busy || !contact) return;
    if (!first && !reply && !body && !pending.length) return;
    if (!first && !reply && patTimer.current) {
      window.clearTimeout(patTimer.current);
      patTimer.current = null;
    }
    if (!settings.apiKey) {
      setErr("还没填 API key。回桌面打开「设置」。");
      return;
    }
    setErr(null);

    // 图先落库拿到 id，消息只存 id
    const shots: Photo[] = first || reply ? [] : pending.map((p) => ({
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
    const history = first || reply ? msgs : [...msgs, mine];
    if (!first && !reply) {
      setMsgs(history);
      void saveMsgs([mine]);
      setPending([]);
      setText("");
    }
    setBusy(true);
    if (shots.length) void refreshPhotos(contact.id);
    const nowT = Date.now();
    // 它留过、还没解封的那句。不发进历史（at 在未来，会被当成它最后说的话），
    // 但要在系统提示词里告诉它：留过了，别在聊天里提前说出来
    const pendingNote = history.find((m) => m.morning && !revealed(m, nowT));
    const nightHint =
      !first && !reply && GOODNIGHT.test(body)
        ? "她在说晚安 / 要去睡了。想的话，可以用 leave_morning_note 给她留一句明早才看得到的话。"
        : "";

    try {
      // 带图的那条按 OpenAI 多模态格式发。**不猜模型能不能看图**——
      // 按名字猜能力是错的，会把图悄悄丢掉且查不出原因。发过去让上游说话。
      const convo: ApiMsg[] = await Promise.all(
        history
          // 事件不发给模型——除了她拍了拍它：那一下是冲着它来的，它得知道。
          // 它自己拍回去的那几行不发：它在那一轮里调过工具，而把「[你拍了拍她]」
          // 当成它说过的话塞回去，它下次就会学着把这行字直接打出来。
          .filter((m) => revealed(m, nowT) && (m.role !== "event" || m.pat === "her"))
          .map(async (m): Promise<ApiMsg> => {
            if (m.role === "event") return { role: "user", content: "[她拍了拍你]" };
            // 转发来的动态：先说清是谁的、哪天的，再接她自己附的话（如果有）
            const said = m.share
              ? [shareText(m.share), m.content.trim()].filter(Boolean).join("\n")
              : m.content;
            const ids = [...(m.share?.photoIds ?? []), ...(m.photoIds ?? [])];
            if (!ids.length) return { role: m.role, content: said };
            const parts: unknown[] = [];
            // ⚠️ 没打字发图时**不要**替她编一句「分析这张图片」。
            // 那一句会让它去做图像分析，而不是像收到一张照片那样说话。
            if (said.trim()) parts.push({ type: "text", text: said });
            for (const id of ids) {
              // 转发来的图不在这个联系人的相册范围里，按 id 现取
              const p =
                photos[id] ?? shots.find((s) => s.id === id) ?? (await get<Photo>("photos", id));
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
        // ⚠️ **正在放什么要在这儿现取。** 放在 useMemo 里的话，她随口
        // 说「这句好戳」的时候，模型手上还是上一句甚至上一首。
        player.track
          ? [
              `你们正一起听《${player.track.title}》${player.track.artist ? " - " + player.track.artist : ""}。`,
              player.nowLyric(),
              // ⚠️ **得让它知道清单里后面还有什么，skip_song 才有意义。**
              // 不给的话「下一首是什么」它只能瞎猜，而猜错的代价是
              // 它信誓旦旦地报了一首根本不在清单里的歌。
              (() => {
                const i = player.queue.findIndex((q) => q.id === player.track!.id);
                const rest = i < 0 ? [] : player.queue.slice(i + 1, i + 4);
                if (!rest.length) return "这是清单里的最后一首。";
                const more = player.queue.length - i - 1 > 3 ? " 等" : "";
                return `清单里后面还排着：${rest.map((q) => `《${q.title}》`).join("、")}${more}。`;
              })(),
              "她要是说到「这句」「这一段」，指的多半就是上面那句。",
            ]
              .filter(Boolean)
              .join("\n")
          : "",
        // 两个人的状态、留了还没解封的那句、晚安提醒。**都是每条都可能变的**，跟在时间后面
        [
          statusLine("她", myStatus(settings, nowT), nowT),
          statusLine("你", liveStatus(contact.status, nowT), nowT),
          pendingNote
            ? `你给她留了一句明早才解封的话：「${pendingNote.content}」——她还没看到，别在聊天里提前说出来。`
            : "",
          nightHint,
        ]
          .filter(Boolean)
          .join("\n"),
      ) + (first ? OPEN_RULE : reply === "pat" ? PAT_RULE : "");
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
            // 排进待播，不打断她在听的那首
            queueSong: settings.musicApiBase.trim()
              ? async (kw: string) => {
                  const hits = await searchSongs(settings.musicApiBase.trim(), kw);
                  const pick = hits.find((h) => !h.vip) ?? hits[0];
                  if (!pick) return `没搜到「${kw}」。`;
                  const t = {
                    id: `net-${pick.songId}`,
                    contactId: PHONE,
                    kind: "online" as const,
                    title: pick.title,
                    artist: pick.artist,
                    songId: pick.songId,
                    cover: pick.cover,
                    at: Date.now(),
                  };
                  // ⚠️ **排队的歌不落库。** 曲库是她挑过的东西；
                  // 它排一首就往里塞一首的话，曲库会慢慢变成它的收藏夹。
                  player.enqueue(t);
                  // ⚠️ 清单空着的时候「排进去」不会有任何动静——
                  // 得说清楚是排上了还是开始放了，不然它以为自己放了歌。
                  const started = !player.track;
                  if (started) player.play(t);
                  return started
                    ? `清单本来是空的，直接放了《${pick.title}》- ${pick.artist}。`
                    : `排进清单了：《${pick.title}》- ${pick.artist}。等这首放完就是它。`;
                }
              : undefined,
            // 明早才解封的那句。**at 就是解封时刻**，所以它在对话里天然排在「早上」
            leaveMorningNote: async (words: string) => {
              const at = Date.now();
              const open = morningAfter(at);
              const rows = await loadMsgs(contact.id);
              // 一晚只留一句：还没解封的那句就地换掉，不叠第二句，也不再冒第二行提示
              const old = rows.find((m) => m.morning && !revealed(m, at));
              const note: Msg = {
                id: old?.id ?? newId(),
                contactId: contact.id,
                role: "assistant",
                content: words,
                morning: true,
                hiddenUntil: open,
                at: open,
              };
              const hint: Msg = {
                id: newId(),
                contactId: contact.id,
                role: "event",
                content: `${displayName(contact)}给你留了一句话，明早打开就能看到`,
                at,
              };
              await saveMsgs(old ? [note] : [note, hint]);
              return old ? "换好了，她还是明早才看得到。" : "留好了。她明早才看得到，今晚别提。";
            },
            // 它自己的状态。挂在联系人身上：主页、会话列表、聊天页顶上一处改处处有
            setStatus: async (word: string, words: string) => {
              onSetContactStatus(contact.id, word ? { word, text: words || undefined, at: Date.now() } : undefined);
              return word ? `状态换成了「${word}」。` : "状态清掉了。";
            },
            // 拍回去：只是一行小字。写进库就行——这一轮回复结束时会整段重读，自然看得到
            patBack: async () => {
              await saveMsgs([
                {
                  id: newId(),
                  contactId: contact.id,
                  role: "event",
                  content: `${displayName(contact)}拍了拍你`,
                  pat: "them",
                  at: Date.now(),
                },
              ]);
              return "拍回去了。";
            },
            likeSong: settings.musicApiBase.trim()
              ? async () => {
                  const t = player.track;
                  if (!t?.songId) return "现在没在放在线的歌，收不了。";
                  if (player.liked(t.songId)) return `《${t.title}》本来就在「我喜欢的音乐」里了。`;
                  try {
                    await player.setLike(t.songId, true);
                    return `收进「我喜欢的音乐」了：《${t.title}》- ${t.artist}。`;
                  } catch (e) {
                    // ⚠️ 失败要如实说。它以为收上了、回头跟她提起，
                    // 而她那边根本没有——那比没收更难解释。
                    return `没收上：${e instanceof Error ? e.message : String(e)}`;
                  }
                }
              : undefined,
            skipSong: (back: boolean) => {
              if (!player.track) return "现在没在放歌，没得切。";
              // ⚠️ 清单只有一首时 step 会原地打转（它自己转一圈回到自己），
              // 看着像「切了但没换」。如实说，别让它以为切成功了。
              if (player.queue.length < 2) return "清单里就这一首，没有下一首可切。";
              if (back) player.prev();
              else player.next();
              return back ? "回到上一首了。" : "切到下一首了。";
            },
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

      // ⚠️ **它说「没有」的时候要真的什么都不留下。**
      // 这是整条规矩的落点：先开口的前提是带来了一件东西，
      // 没带来就该沉默——留一句「在吗」正是她当初否掉的那种打扰。
      // 拍一拍也一样：它回个减号就是「不接」，什么都不留
      const pass = (first || reply === "pat") && PASS.test(visible.trim());
      if (visible.trim() && !pass) {
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
  }, [text, pending, busy, contact, msgs, settings, diary, memory, notes, photos, refreshPhotos, player, onSetContactStatus]);

  /// ⚠️ 上面那个 effect 要用 send，但 send 定义在它后面、而且每次渲染都换新的。
  /// 放进依赖里会让 effect 每次都重跑（= 反复开口）。用 ref 拿最新的那个。
  const sendRef = useRef<typeof send | null>(null);
  sendRef.current = send;

  /// 拍一拍。
  ///
  /// ⚠️ **双击头像是拍，单击还是进主页**——单击得等一下，确认不是双击的前半下。
  /// 等 260ms：再短人手来不及点第二下，再长点头像进主页会觉得卡。
  /// 头像挂在每一段话旁边，她那侧也有：双击它的是拍它；双击自己的是「拍了拍自己」
  /// ——和微信一样，拍自己不通知任何人，它也就不接。
  /// ⚠️ **连拍好几下只让它接一次。** 每一下都记一行，回话要等最后一下落定 1.5 秒后才问。
  const myFace = useMe(settings);
  /// 刚被拍的是哪个头像（顶栏那个叫 "header"）。n 每拍一下加一，换 key 让晃的动画重放
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);
  const tapTimer = useRef<number | null>(null);
  const tapKey = useRef("");
  useEffect(
    () => () => {
      // 换人、离开聊天：等着的单击和等着的回话都作废，别让它跑到另一段对话里去
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      if (patTimer.current) window.clearTimeout(patTimer.current);
      tapTimer.current = null;
      patTimer.current = null;
    },
    [contact?.id],
  );

  const pat = (who: "them" | "self", at: string) => {
    if (!contact) return;
    // ⚠️ 震动必须在这一下点击里同步调，放到 await 后面就不算手势了
    haptic();
    setShake((prev) => ({ id: at, n: (prev?.n ?? 0) + 1 }));
    const ev: Msg = {
      id: newId(),
      contactId: contact.id,
      role: "event",
      content: who === "them" ? `你拍了拍${displayName(contact)}` : "你拍了拍自己",
      pat: who === "them" ? "her" : "self",
      at: Date.now(),
    };
    setMsgs((ms) => [...ms, ev]);
    void saveMsgs([ev]);
    if (who === "self") return;
    if (patTimer.current) window.clearTimeout(patTimer.current);
    patTimer.current = window.setTimeout(() => {
      patTimer.current = null;
      if (!settings.apiKey.trim()) return;
      void sendRef.current?.(false, "pat");
    }, 1500);
  };

  /// 点头像。who：点的是它的还是自己的；at：点的是哪一个头像，晃的时候只晃那一个
  const tapFace = (who: "them" | "self", at: string) => {
    const key = `${who}:${at}`;
    if (tapTimer.current && tapKey.current === key) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      pat(who, at);
      return;
    }
    // 先点了别的头像、紧接着点这个：前一下作废，不算双击
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    tapKey.current = key;
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      if (who === "self") onOpenProfile("me");
      else if (contact) onOpenProfile(contact);
    }, 260);
  };

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
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[15px] truncate" style={{ color: "var(--ink)" }}>
                    {displayName(c)}
                  </span>
                  {liveStatus(c.status) && (
                    <span className="text-[11px] truncate max-w-[50%]" style={{ color: "var(--ink-faint)" }}>
                      {statusLabel(liveStatus(c.status)!)}
                    </span>
                  )}
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

  /// 明早才解封的那句，到点之前不画
  const shown = msgs.filter((m) => revealed(m));

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
        {/* 点头像进主页，**双击头像是拍一拍**。名字那块单击直接进主页，不用等那 260ms */}
        <button
          onClick={() => tapFace("them", "header")}
          className="shrink-0 active:opacity-60"
          aria-label={`${displayName(contact)}，双击拍一拍`}
        >
          {/* 换 key = 重新挂载 = 晃的动画再放一遍 */}
          <span
            key={shake?.id === "header" ? `header-${shake.n}` : "header"}
            className={`block ${shake?.id === "header" ? "anim-pat" : ""}`}
          >
            <Avatar face={faceOf(contact)} size={32} />
          </span>
        </button>
        <button onClick={() => onOpenProfile(contact)} className="active:opacity-60 min-w-0 text-left">
          <span className="block text-[16px] font-medium truncate" style={{ color: "var(--ink)" }}>
            {displayName(contact)}
          </span>
          {liveStatus(contact.status) && (
            <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
              {statusLabel(liveStatus(contact.status)!)}
            </span>
          )}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-2 flex flex-col gap-2.5">
        {shown.length === 0 && !busy && (
          <div className="flex-1 grid place-items-center px-8">
            <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
              还没有说过话。
            </p>
          </div>
        )}

        {shown.map((m, i) => (
          <Fragment key={m.id}>
            {/* 跨天 / 隔了很久，插一条居中的分隔。**只在真的断开时插**——
                每条都写日期就成了流水账，而分隔的意义正是「这里断过」。 */}
            {gapLabel(shown[i - 1]?.at, m.at) && (
              <div
                className="self-center px-4 py-1 text-[11px]"
                style={{ color: "var(--ink-faint)" }}
              >
                {gapLabel(shown[i - 1]?.at, m.at)}
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
              // ⚠️ **头像挂在每一段的第一句旁边，不是每一句。** 连着说三句就三个头像的话，
              // 一列一样的脸比气泡还显眼。换人说、中间隔了一行小字或一条时间分隔，才算新的一段。
              <div
                className={`max-w-[90%] flex items-start gap-2 ${
                  m.role === "user" ? "self-end flex-row-reverse" : "self-start"
                }`}
              >
                <span className="w-8 shrink-0">
                  {(i === 0 || shown[i - 1].role !== m.role || !!gapLabel(shown[i - 1]?.at, m.at)) && (
                    <button
                      onClick={() => tapFace(m.role === "user" ? "self" : "them", m.id)}
                      aria-label={m.role === "user" ? "我，双击拍拍自己" : `${displayName(contact)}，双击拍一拍`}
                      className="block active:opacity-60"
                    >
                      <span
                        key={shake?.id === m.id ? `${m.id}-${shake.n}` : m.id}
                        className={`block ${shake?.id === m.id ? "anim-pat" : ""}`}
                      >
                        <Avatar face={m.role === "user" ? myFace : faceOf(contact)} size={32} />
                      </span>
                    </button>
                  )}
                </span>
              <div
                className={`min-w-0 flex flex-col gap-1.5 ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                {m.morning && (
                  // 早上解封的那句，标一下来历——不然看着就是它五点整发来一条消息
                  <span className="text-[10px] px-1" style={{ color: "var(--ink-faint)" }}>
                    昨晚留给你的
                  </span>
                )}
                {m.share && (
                  // 转发来的动态。**做成一张卡，不是一个气泡**——气泡是「说的话」，
                  // 这是「递过来的东西」。混成一种样子，就分不清哪句是她说的、哪句是原帖。
                  <div
                    className="rounded-[16px] px-3 py-2.5 w-[232px] max-w-full"
                    style={{
                      background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
                      border: "1px solid var(--glass-edge)",
                    }}
                  >
                    <div className="text-[11px] pb-1" style={{ color: "var(--ink-faint)" }}>
                      {m.share.by === "her" ? "我的动态" : `${m.share.byName}的动态`} ·{" "}
                      {timeAgo(m.share.at)}
                    </div>
                    {!!m.share.text.trim() && (
                      <p
                        className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words line-clamp-5"
                        style={{ color: "var(--ink)" }}
                      >
                        {m.share.text}
                      </p>
                    )}
                    {!!m.share.photoIds?.length && (
                      <div className="grid grid-cols-3 gap-1 pt-1.5">
                        {m.share.photoIds.slice(0, 3).map((id) => {
                          const ph = photos[id] ?? sharePhotos[id];
                          return (
                            <button key={id} onClick={() => ph && setViewing(ph)}>
                              <PhotoImg
                                photo={ph}
                                className="rounded-[8px] object-cover w-full"
                                style={{ aspectRatio: "1 / 1" }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
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
                    // ⚠️ max-w-full 不能省：外面那列是 items-start 的竖排 flex，气泡按内容宽度排，
                    // 一长串不换行的链接会把它撑出屏幕，break-words 根本没机会断
                    className="max-w-full px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
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
              </div>
            )}
          </Fragment>
        ))}

        {busy && (
          <div className="self-start flex items-start gap-2">
            <span className="w-8 shrink-0">
              <Avatar face={faceOf(contact)} size={32} />
            </span>
            <div className="px-3.5 py-3" style={{ borderRadius: "20px 20px 20px 6px", ...bubble.them }}>
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "var(--ink-faint)", animationDelay: `${i * 160}ms` }} />
                ))}
              </span>
            </div>
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

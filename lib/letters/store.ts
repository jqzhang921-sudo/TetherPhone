"use client";
import { claim, getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";
import type { PaperRule } from "@/lib/paper";

/// 信。
///
/// **和日记的分界不在形式，在去处**：日记是写给自己的，公开了对方才看得到；
/// 信从一开始就是给对方的，写完要**寄出**。
///
/// ⚠️ **信不进实时对话的上下文。** 这条是从 phone-ai-assistant 搬来的，
/// 原话是「信刻意不进检索、连形状都不给——它的价值有一半来自不在实时对话里」。
/// 公开的日记会注入聊天，信不会。写信那一次的上下文是一次性的，不常驻。
export type Letter = {
  id: string;
  contactId: string;
  author: "me" | "them";
  text: string;
  paperTint: string;
  paperRule: PaperRule;
  envelope: string;
  /// 随信寄的图。只存 id，图在 photos 表里。
  photoIds?: string[];
  /// 寄出的时刻。信没有草稿态——**写了就寄**，攒着不发的信是备忘录不是信。
  sentAt: number;
  /// 拆开的时刻。null = 还封着。
  openedAt: number | null;
  /// 我寄出的信，它大概什么时候回。它自己写的信不需要这个。
  replyDueAt?: number | null;
  replied?: boolean;
};

export const ENVELOPES = [
  { id: "linen", name: "本色", css: "oklch(0.90 0.022 80)" },
  { id: "rose", name: "藕", css: "oklch(0.86 0.045 15)" },
  { id: "sea", name: "海", css: "oklch(0.85 0.045 220)" },
  { id: "moss", name: "苔", css: "oklch(0.86 0.045 145)" },
];

export const envelopeCss = (id: string) =>
  ENVELOPES.find((e) => e.id === id)?.css ?? ENVELOPES[0].css;

/// 回信要隔多久。
///
/// 随机而不是固定，是**防止被认出来**——固定四十分钟，第三封就露馅了。
/// 范围抄的是 phone-ai-assistant 里那套（25~100 分钟），那边是真机上调过的。
///
/// 网页版没有后台，所以「隔了多久」只在**你下次打开信箱时**兑现。
/// 这不是妥协：信本来就该是「你回来的时候它在那儿」，不是叮一声弹出来。
const REPLY_MIN = 25 * 60_000;
const REPLY_MAX = 100 * 60_000;

export const replyDelay = () =>
  REPLY_MIN + Math.floor(Math.random() * (REPLY_MAX - REPLY_MIN));

export async function loadLetters(contactId: string): Promise<Letter[]> {
  const rows = await getAllBy<Letter>("letters", contactId);
  return rows.sort((a, b) => b.sentAt - a.sentAt);
}

export const saveLetter = (l: Letter) => put("letters", l);
export const deleteLetter = (id: string) => remove("letters", id);

/// 原子地挑一封「到点该回、还没回」的信并当场占坑。
///
/// ⚠️ 和动态那边同一个理由：写一封信要好几秒，挑和占分成两步的话，
/// 这几秒里另一个调用会挑中同一封，于是回两封。
export function claimDue(contactId: string): Promise<Letter | null> {
  return claim<Letter>("letters", (store, done, fail) => {
    const req = store.index("contactId").getAll(contactId);
    req.onsuccess = () => {
      const hit = (req.result as Letter[]).find(
        (l) => l.author === "me" && !l.replied && l.replyDueAt != null && l.replyDueAt <= Date.now(),
      );
      if (!hit) return;
      const taken = { ...hit, replied: true };
      const w = store.put(taken);
      w.onsuccess = () => done(taken);
      w.onerror = () => fail(w.error);
    };
    req.onerror = () => fail(req.error);
  });
}

export function blankLetter(contactId: string, author: Letter["author"]): Letter {
  return {
    id: newId(),
    contactId,
    author,
    text: "",
    paperTint: "cream",
    paperRule: "line",
    envelope: "linen",
    sentAt: Date.now(),
    // 自己寄出的信不用拆——拆的是收到的那些。
    openedAt: author === "me" ? Date.now() : null,
  };
}

/// 还没拆的（只算它寄来的）。桌面图标上的红点用它。
export const unreadCount = (rows: Letter[]) =>
  rows.filter((l) => l.author === "them" && l.openedAt === null).length;

export { dayLabel } from "@/lib/paper";

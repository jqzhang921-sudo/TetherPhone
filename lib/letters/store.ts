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
  /// 约好哪天才能拆（那天的零点，本地时间）。没有 = 寄到就能拆。
  ///
  /// - 她寄的：它要到那天才拆，回信也从那天往后算。
  /// - 它寄的：她现在就看得见信封，拆不开；到了那天才拆得开。
  ///
  /// ⚠️ 没到日子的信，**正文照样不进 DOM**——和所有封着的信一样，不是 CSS 藏起来。
  openAt?: number | null;
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

// ── 约日子 ─────────────────────────────────────────────────────

/// 约了日子、还没到
export const locked = (l: Letter, now = Date.now()) => !!l.openAt && l.openAt > now;

/// 约日子最远能约多远。再远，这台手机和这份数据还在不在都说不准
export const OPEN_AT_MAX_DAYS = 3 * 366;

/// 那一天的零点（本地时间）
export function dayStartOf(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/// n 天之后那天的零点
export function daysLater(n: number, now = Date.now()) {
  const d = new Date(dayStartOf(now));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/// 一个月后的同一天零点。那个月没有这一天就落在月底（1 月 31 日 → 2 月 28 日）
export function monthLater(now = Date.now()) {
  const d = new Date(dayStartOf(now));
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/// "2026-09-20" → 那天零点。认不出来、或者根本没有这一天，返回 null
export function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da);
  // ⚠️ new Date(2026, 1, 31) 不报错，会自己滚到三月三号——滚了就说明没有这一天
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d.getTime();
}

/// 零点 → "2026-09-20"（给 <input type="date"> 用）
export function isoDay(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/// 还有几天。按日历天算：今晚十一点看明天拆的信，是「还有 1 天」，不是「还有 1 小时」。
/// ⚠️ 用 round 不用 floor：夏令时那天不是 24 小时
export const daysUntil = (at: number, now = Date.now()) =>
  Math.round((dayStartOf(at) - dayStartOf(now)) / 86_400_000);

/// "9月20日"。不是今年的带上年份
export function shortDay(at: number, now = Date.now()) {
  const d = new Date(at);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/// 还没拆的（只算它寄来的）。桌面图标上的红点用它。
///
/// ⚠️ **没到日子的不算。** 一封下个月才能拆的信挂一个月红点，点进去又拆不开，那是折磨。
/// 到了那天它自己就算进来了——红点亮起来，正好就是「今天可以拆了」。
export const unreadCount = (rows: Letter[], now = Date.now()) =>
  rows.filter((l) => l.author === "them" && l.openedAt === null && !locked(l, now)).length;

export { dayLabel } from "@/lib/paper";

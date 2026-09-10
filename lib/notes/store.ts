"use client";
import { getAllBy, put, remove } from "@/lib/db/idb";
import { hashOf, newId } from "@/lib/id";

/// 备忘录 = 一块两个人共用的板。
///
/// 规矩搬自 phone-ai-assistant 的「小事」，一条都别改：
/// - **带勾选框**
/// - **绝不自动消失**（没勾的那些，多久都在）
/// - **勾掉留一周可撤销**，一周后才真的清掉
///
/// 「绝不自动消失」是关键：一条自己沉下去的待办，从人的角度和 bug 分不开。
export type Note = {
  id: string;
  contactId: string;
  author: "me" | "them";
  text: string;
  done: boolean;
  /// 勾掉的时刻。撤销窗口从这里算。
  doneAt: number | null;
  at: number;
};

const KEEP_DONE = 7 * 24 * 60 * 60_000;

/// 四种纸色，按 id 哈希取——同一张便签每次看都是同一个颜色。
export const PAPER = [
  "oklch(0.93 0.055 95)",
  "oklch(0.92 0.05 150)",
  "oklch(0.92 0.05 350)",
  "oklch(0.92 0.05 235)",
];
export const paperOf = (id: string) => PAPER[hashOf(id) % PAPER.length];

/// 读的时候顺手清掉一周前勾掉的。
/// **只清勾过的**——没勾的一条都不动。
export async function loadNotes(contactId: string): Promise<Note[]> {
  const rows = await getAllBy<Note>("notes", contactId);
  const stale = rows.filter((n) => n.done && n.doneAt != null && Date.now() - n.doneAt > KEEP_DONE);
  for (const n of stale) await remove("notes", n.id);
  return rows
    .filter((n) => !stale.includes(n))
    .sort((a, b) => Number(a.done) - Number(b.done) || b.at - a.at);
}

export const saveNote = (n: Note) => put("notes", n);
export const deleteNote = (id: string) => remove("notes", id);

export function blankNote(contactId: string, author: Note["author"], text: string): Note {
  return { id: newId(), contactId, author, text, done: false, doneAt: null, at: Date.now() };
}

/// 给模型看的那一段。**只列没勾的**——勾掉的事再提就是催。
/// 板是公用的，它该知道上面有什么，但知道 ≠ 该开口提。
export function boardText(rows: Note[]): string {
  const todo = rows.filter((n) => !n.done).slice(0, 10);
  if (!todo.length) return "";
  return (
    "备忘录上现在有（你们俩共用的板，你也能往上写）：\n" +
    todo.map((n) => `- ${n.text}${n.author === "them" ? "（你写的）" : ""}`).join("\n")
  );
}

"use client";
import { getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";
import type { PaperRule } from "@/lib/paper";

/// 交换日记：两边各写各的，选择性给对方看。
///
/// ⚠️ 这和 phone-ai-assistant 里「日记不给用户写入口」的决定是相反的，
/// 是**故意**的：那边日记的价值在「这是它自己写的」，是单向的；
/// 这里是交换日记，另一个东西。
export type DiaryEntry = {
  id: string;
  contactId: string;
  /// 谁写的
  author: "me" | "them";
  text: string;
  paperTint: string;
  paperRule: PaperRule;
  /// 私密 = 对方看不见。**公开是一个动作，不只是一个开关**——
  /// 公开时会在聊天里落下一行，见 diary-app 的公开按钮。
  secret: boolean;
  at: number;
};

export async function loadDiary(contactId: string): Promise<DiaryEntry[]> {
  const rows = await getAllBy<DiaryEntry>("diary", contactId);
  return rows.sort((a, b) => b.at - a.at);
}

export const saveEntry = (e: DiaryEntry) => put("diary", e);
export const deleteEntry = (id: string) => remove("diary", id);

export function blankEntry(contactId: string, author: DiaryEntry["author"]): DiaryEntry {
  return {
    id: newId(),
    contactId,
    author,
    text: "",
    paperTint: "cream",
    paperRule: "line",
    // 默认不私密。**默认私密是错的**——那会让「公开」变成常态动作，
    // 常态动作没有分量。
    secret: false,
    at: Date.now(),
  };
}

// 纸和日期从公共层来。日记和信是同一种材质上的两件东西。
export {
  PAPER_RULES,
  PAPER_TINTS,
  dayLabel,
  paperStyle,
  tintCss,
  type PaperRule,
} from "@/lib/paper";

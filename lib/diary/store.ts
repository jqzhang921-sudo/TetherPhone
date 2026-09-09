"use client";
import { getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";

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
  /// 公开时会在聊天里落下一行，见 diary-app 的 reveal。
  secret: boolean;
  at: number;
};

export type PaperRule = "blank" | "line" | "grid";

export const PAPER_RULES: { id: PaperRule; name: string }[] = [
  { id: "blank", name: "空白" },
  { id: "line", name: "横线" },
  { id: "grid", name: "方格" },
];

export const PAPER_TINTS = [
  { id: "cream", name: "米白", css: "oklch(0.965 0.014 85)" },
  { id: "sand", name: "淡黄", css: "oklch(0.945 0.035 90)" },
  { id: "sky", name: "淡蓝", css: "oklch(0.945 0.028 230)" },
  { id: "blush", name: "淡粉", css: "oklch(0.945 0.028 15)" },
];

export const tintCss = (id: string) =>
  PAPER_TINTS.find((t) => t.id === id)?.css ?? PAPER_TINTS[0].css;

/// 纸的纹理。纯 CSS，没有图片——横线和方格就是重复渐变，
/// 换纸色时线的颜色跟着底色走，不会出现「白纸的线画在黄纸上」。
export function paperStyle(tint: string, rule: PaperRule, lineGap = 30): React.CSSProperties {
  const bg = tintCss(tint);
  const ink = "oklch(0.55 0.03 250 / 0.22)";
  if (rule === "line") {
    return {
      background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${lineGap - 1}px, ${ink} ${lineGap - 1}px, ${ink} ${lineGap}px), ${bg}`,
    };
  }
  if (rule === "grid") {
    return {
      background:
        `repeating-linear-gradient(to bottom, transparent 0, transparent ${lineGap - 1}px, ${ink} ${lineGap - 1}px, ${ink} ${lineGap}px), ` +
        `repeating-linear-gradient(to right, transparent 0, transparent ${lineGap - 1}px, ${ink} ${lineGap - 1}px, ${ink} ${lineGap}px), ` +
        bg,
    };
  }
  return { background: bg };
}

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

export const dayLabel = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

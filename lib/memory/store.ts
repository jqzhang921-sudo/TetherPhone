"use client";
import { getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";

/// 记忆。结构照搬 phone-ai-assistant 里调出来的那版，一个字没改：
/// **分类 + 名字 + 一行摘要 + 若干细节**，而且**只有摘要常驻**，
/// 细节用工具取。好处是记得越多、常驻成本几乎不涨——多数开源方案做不到这点。
///
/// ⚠️ 别把它改回「每条一行全量塞进上下文」。那条路试过又退回来了：
/// 当时的理由「不这样它不知道有东西可翻」不成立——工具描述一直在上下文里，
/// 那就是钩子。而且**摘要必须是专门写的一行**，不能拿正文开头几十字凑
/// ——一句断掉的话看不出讲什么，那才是上次失败的真原因。
export type MemoryTopic = {
  id: string;
  contactId: string;
  kind: Kind;
  /// 话题名，几个字
  name: string;
  /// 一行摘要。**常驻上下文的只有这一行**，所以它得能当钩子用。
  summary: string;
  details: string[];
  at: number;
};

export type Kind = "who" | "cares" | "between" | "avoid";

/// 分类是固定的四类，不让模型自己造。
///
/// 划线原则（这条最有用）：需要「不问就知道」的进上下文，
/// 需要「问了才翻」的进工具。名字、称呼、在意什么、不喜欢被怎么对待
/// → 常驻；某天说过的某句话 → 细节。
export const KINDS: { id: Kind; name: string; hint: string; tint: string }[] = [
  { id: "who", name: "她是谁", hint: "名字、身份、在做的事", tint: "oklch(0.68 0.12 145)" },
  { id: "cares", name: "在意什么", hint: "喜欢的、放不下的、想做的", tint: "oklch(0.72 0.13 60)" },
  { id: "between", name: "我们之间", hint: "一起经过的事、只有你俩懂的说法", tint: "oklch(0.68 0.12 320)" },
  { id: "avoid", name: "别这样对她", hint: "她不喜欢被怎么对待", tint: "oklch(0.66 0.11 25)" },
];

export const kindOf = (id: string) => KINDS.find((k) => k.id === id) ?? KINDS[0];

/// 上限。**满了要拒绝，不能挤掉最旧的**——悄悄沉下去一条，
/// 从用户角度和 bug 分不开。拒绝时把现有的列出来，让它自己选择改哪条。
export const MAX_TOPICS_PER_KIND = 5;
export const MAX_DETAILS = 12;

export async function loadMemory(contactId: string): Promise<MemoryTopic[]> {
  const rows = await getAllBy<MemoryTopic>("memory", contactId);
  // ⚠️ **按分类 + 创建时间升序，不能按最近更新排。**
  // 摘要是拼进 system 前缀的，顺序一变就把前缀整段重排、
  // 把历史挤出 KV 缓存——改一条记忆的代价会变成重算整段上下文。
  return rows.sort((a, b) =>
    a.kind === b.kind ? a.at - b.at : KINDS.findIndex((k) => k.id === a.kind) - KINDS.findIndex((k) => k.id === b.kind),
  );
}

export const saveTopic = (t: MemoryTopic) => put("memory", t);
export const deleteTopic = (id: string) => remove("memory", id);

export function blankTopic(contactId: string, kind: Kind): MemoryTopic {
  return { id: newId(), contactId, kind, name: "", summary: "", details: [], at: Date.now() };
}

/// 常驻那一段。**只有摘要**，一条一行。
export function digest(rows: MemoryTopic[]): string {
  if (!rows.length) return "";
  const out: string[] = ["你记着的（细节用 open_memory 取，别凭这一行猜）："];
  for (const k of KINDS) {
    const mine = rows.filter((r) => r.kind === k.id);
    if (!mine.length) continue;
    out.push(`【${k.name}】`);
    for (const t of mine) {
      out.push(`- ${t.name}：${t.summary}${t.details.length ? `（${t.details.length} 条细节）` : ""}`);
    }
  }
  return out.join("\n");
}

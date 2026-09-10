"use client";
import { getAll, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";

/// 一个联系人 = 一个角色。
///
/// **人设、模型、记忆都挂在这里，不在全局设置里。** 这是整个数据模型的地基：
/// 需求里所有「双方」「每个人」——日记双方写、相册每个人存、备忘录每个人写、
/// 聊天有备注和主页——指的都是它。UI 上先只有一个联系人也没关系，
/// 字段现在不穿进去，以后就不是加字段，是把每张表的取数逻辑改一遍。
///
/// ⚠️ 这里**没有** worldbook（世界书）。人设是常驻系统提示词，世界书是
/// 命中关键词才注入，去处不同；混在一起最典型的症状是「明明写了它却不知道」。
/// 等人设真的写不下了再说。
export type Contact = {
  id: string;
  /// 它自己的名字
  name: string;
  /// 用户给它起的备注。有备注就显示备注——和真通讯录一样。
  note: string;
  /// 没设图片头像时用的 emoji + 底色。
  emoji: string;
  tint: string;
  /// 图片头像。**存的是裁好的小图本身，不是相册里那张的 id**——
  /// 头像该比来源活得久，把原图从相册删掉不该让头像变空白。
  /// 见 lib/os/avatar.ts。
  avatar?: Blob;
  /// 虚拟号码。现在纯装饰，将来打电话用得上。
  phone: string;
  signature: string;
  /// 进系统提示词。只写它是谁，别挂形容词——挂了模型就去演那个词。
  persona: string;
  /// 留空 = 用全局默认模型
  model: string;
  /// 用户气泡色；它的气泡跟着玻璃走
  bubble: string;
  /// 一起听歌累计的秒数。**挂在联系人身上**——「一起听了多久」是你和它之间的事，
  /// 不是这台手机的属性。
  together?: number;
  /// 一起听过多少首。**按「开始放一首」计**，不按听完计——
  /// 跳过的那些也是一起经过的。
  songs?: number;
  createdAt: number;
};

export const displayName = (c: Contact) => c.note.trim() || c.name.trim() || "未命名";

const TINTS = [
  "oklch(0.72 0.15 250)",
  "oklch(0.74 0.15 30)",
  "oklch(0.76 0.13 150)",
  "oklch(0.72 0.13 300)",
  "oklch(0.75 0.12 85)",
];

/// 号码是假的，但要长得像真的——`138` 开头 + 8 位随机。
const fakePhone = () =>
  `138 ${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")} ${String(
    Math.floor(Math.random() * 1e4),
  ).padStart(4, "0")}`;

export function blankContact(seed?: Partial<Contact>): Contact {
  return {
    id: newId(),
    name: "",
    note: "",
    emoji: "🌙",
    tint: TINTS[Math.floor(Math.random() * TINTS.length)],
    phone: fakePhone(),
    signature: "",
    persona: "",
    model: "",
    bubble: "oklch(0.62 0.14 250)",
    createdAt: Date.now(),
    ...seed,
  };
}

export async function loadContacts(): Promise<Contact[]> {
  const rows = await getAll<Contact>("contacts");
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export const saveContact = (c: Contact) => put("contacts", c);
export const deleteContact = (id: string) => remove("contacts", id);

/// 第一次进来给一个空联系人，否则桌面上什么都点不动。
/// 顺手把旧版本存在全局设置里的名字/人设搬过来——那两个字段是
/// 「只有一个 AI」时代的遗留，现在归联系人管。
export async function ensureSeed(legacy?: { aiName?: string; persona?: string }) {
  const existing = await loadContacts();
  if (existing.length) return existing;
  const first = blankContact({
    name: legacy?.aiName?.trim() ?? "",
    persona: legacy?.persona?.trim() ?? "",
  });
  await saveContact(first);
  return [first];
}

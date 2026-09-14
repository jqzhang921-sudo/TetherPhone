"use client";
import { getAllBy, putMany, put, clearStore } from "@/lib/db/idb";

/// `event` 不是谁说的话，是「发生了一件事」——比如把一篇私密日记公开给对方看。
/// 在聊天里渲染成一行居中的小字，**不发给模型**（模型该看到的是日记正文本身，
/// 那是另一条注入路径）。
export type Role = "user" | "assistant" | "event";

/// 每条消息都带 contactId —— 换联系人就是换一整段对话。
export type Msg = {
  id: string;
  contactId: string;
  role: Role;
  content: string;
  /// 图只存 id，图本身在 photos 表里（lib/photos/store.ts）。
  /// 同一张图可能同时出现在聊天、相册、日记里，各存一份的话
  /// 改一处得改三处、删一处剩两份孤儿。
  photoIds?: string[];
  /// 转发过来的一条动态（见 Share）。
  share?: Share;
  /// 拍一拍（role 是 event）。her = 她拍了它；them = 它拍回来。
  pat?: "her" | "them";
  at: number;
};

/// 转发的一条动态。
///
/// ⚠️ **存快照，不存引用。** 原动态可能被删、被改——聊天里那一条是
/// 「那天她给我看过这个」，不该跟着原帖一起没掉，也不该悄悄变成别的话。
/// 图还是只存 id：图删不删归相册管，和聊天里发图同一条规矩。
export type Share = {
  kind: "post";
  /// 原动态的 id。只是个记号，不拿它回查
  postId: string;
  /// 这条动态是谁发的，**相对收到的那个人说**：
  /// her = 她自己发的；you = 就是收到的这个人发的；other = 另一个联系人发的。
  /// ⚠️ 不能只存 author: "me" | "them"——那是相对「动态所在那一页」说的，
  /// 把 A 的动态转给 B，"them" 指的是 A，B 会以为是自己发的。
  by: "her" | "you" | "other";
  /// 发帖人当时的名字。改名之后也认得出那天是谁
  byName: string;
  text: string;
  photoIds?: string[];
  /// 原动态发出的时刻
  at: number;
};

export async function loadMsgs(contactId: string): Promise<Msg[]> {
  const rows = await getAllBy<Msg>("messages", contactId);
  return rows.sort((a, b) => a.at - b.at);
}

export const saveMsg = (m: Msg) => put("messages", m);
export const saveMsgs = (ms: Msg[]) => putMany("messages", ms);
export const clearAllMsgs = () => clearStore("messages");

export { newId } from "@/lib/id";

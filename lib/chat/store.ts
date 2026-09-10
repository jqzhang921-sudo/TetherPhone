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

"use client";
import { getAllBy, putMany, put, clearStore } from "@/lib/db/idb";

export type Role = "user" | "assistant";

/// 每条消息都带 contactId —— 换联系人就是换一整段对话。
export type Msg = {
  id: string;
  contactId: string;
  role: Role;
  content: string;
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

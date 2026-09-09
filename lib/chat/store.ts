"use client";

export type Role = "user" | "assistant";

export type Msg = {
  id: string;
  role: Role;
  content: string;
  at: number;
};

const KEY = "tether.chat.v1";

export function loadMsgs(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

export function saveMsgs(msgs: Msg[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(msgs));
  } catch {
    /* 存不下就只活在这次会话里，不该让聊天本身失灵 */
  }
}

export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

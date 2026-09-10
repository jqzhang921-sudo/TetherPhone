"use client";
import { Avatar } from "./avatar";
import { faceOf } from "@/lib/os/avatar";
import type { Contact } from "@/lib/os/contacts";

/// 「现在看哪个联系人」的那排头像。日记 / 信 / 记忆 / 动态 / 相册 / 便签共用。
///
/// **只渲染按钮本身，外面那层 flex 容器留给各页自己写**——相册和记忆在同一行里
/// 还接着放别的东西（"收着的 / 全部"、"看原文"），容器一起收进来反而卡住它们。
export function ContactStrip({
  contacts,
  who,
  onPick,
  size = 32,
}: {
  contacts: Contact[];
  who: string;
  onPick: (id: string) => void;
  size?: number;
}) {
  return (
    <>
      {contacts.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          className="shrink-0 rounded-full"
          style={{
            opacity: c.id === who ? 1 : 0.4,
            outline: c.id === who ? "2px solid var(--ink)" : "none",
            outlineOffset: 2,
          }}
        >
          <Avatar face={faceOf(c)} size={size} />
        </button>
      ))}
    </>
  );
}

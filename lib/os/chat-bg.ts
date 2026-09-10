"use client";
import { useEffect, useState } from "react";
import { clearContactImage, readContactImage, saveContactImage } from "./contact-image";
import { readImage } from "@/lib/music/tone";

/// 聊天背景。**每个联系人一张**——「每段关系不一样」是这个 App 的地基，
/// 背景是最能体现这件事的地方之一。全局默认等真有人要了再说。
///
/// 存取走 contact-image（和主页横幅同一套：图进 photos 表，Contact 上只留时间戳）。
/// 这里只管聊天背景特有的两件事：**深浅**和**玻璃下限**。
export const saveChatBg = (contactId: string, blob: Blob, w: number, h: number) =>
  saveContactImage("chatbg", contactId, blob, w, h);

export const clearChatBg = (contactId: string) => clearContactImage("chatbg", contactId);

export type ChatSkin = {
  url: string;
  /// 背景自己的深浅。**聊天页整片跟着它翻**——不翻的话，浅色壁纸配深色
  /// 聊天背景会变成深底深字，或者逼玻璃厚到糊成一块白板。
  dark: boolean;
  /// 这张背景上，玻璃最薄能到多薄还读得了字。设在聊天页自己身上，
  /// 半透明的气泡靠 max() 吃它。
  floor: number;
};

/// 读一张聊天背景，顺带把深浅和玻璃下限算出来。
///
/// ⚠️ `at` 是刷新信号（Contact.chatBgAt）。换了背景它一变，这里重读；
/// 没设过是 undefined，直接给 null。
export function useChatSkin(contactId: string, at: number | undefined, aspect: number): ChatSkin | null {
  const [skin, setSkin] = useState<ChatSkin | null>(null);

  useEffect(() => {
    if (!at) {
      setSkin(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    void (async () => {
      const row = await readContactImage("chatbg", contactId);
      if (!row?.blob || !alive) return;
      url = URL.createObjectURL(row.blob);
      // 深浅从图里算，不让人选——选错了整页字就没法看，换一张还得再选一次
      const r = await readImage(url, aspect);
      if (alive) setSkin({ url, dark: r?.tone.dark ?? true, floor: r?.minAlpha ?? 0 });
      else URL.revokeObjectURL(url);
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [contactId, at, aspect]);

  return skin;
}

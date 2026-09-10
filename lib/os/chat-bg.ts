"use client";
import { useEffect, useState } from "react";
import { get, put, remove } from "@/lib/db/idb";
import { PHONE_SCOPE, type Photo } from "@/lib/photos/store";
import { readImage } from "@/lib/music/tone";

/// 聊天背景。**每个联系人一张**——「每段关系不一样」是这个 App 的地基，
/// 背景是最能体现这件事的地方之一。全局默认等真有人要了再说。
///
/// ⚠️ 和头像一样，存的是**图本身**，不是相册里那张的 id：
/// 把原图从相册删掉，聊天背景不该跟着变空白。见 lib/os/avatar.ts。
///
/// 但和头像不一样的是它**很大**（铺满一屏），所以不能挂在 Contact 记录上——
/// contacts 表每次 getAll 都会把整张图读出来，而联系人在启动时就要全部加载。
/// 图放 photos 表里一条固定 id 的记录，Contact 上只留一个时间戳。
const idOf = (contactId: string) => `__chatbg_${contactId}`;

export async function saveChatBg(contactId: string, blob: Blob, w: number, h: number) {
  const row: Photo = {
    id: idOf(contactId),
    contactId: PHONE_SCOPE,
    blob,
    w,
    h,
    from: "me",
    // saved:false → 不会出现在任何相册里。它属于这台手机，不是一张"收着的图"。
    saved: false,
    at: Date.now(),
  };
  await put("photos", row);
}

export const clearChatBg = (contactId: string) => remove("photos", idOf(contactId));

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
      const row = await get<Photo>("photos", idOf(contactId));
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

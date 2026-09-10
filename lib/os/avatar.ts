"use client";
import { useEffect, useState } from "react";
import { get, put, remove } from "@/lib/db/idb";
import { PHONE_SCOPE, type Photo } from "@/lib/photos/store";
import type { Contact } from "./contacts";
import type { Settings } from "./settings";

/// 一张脸。emoji + 底色是兜底，有 blob 就用 blob。
///
/// 头像在聊天、通讯录、资料卡、动态、播放页、便签、桌面组件七处都要画，
/// 之前每处各写一遍圆角 span。收成一个类型 + 一个组件，改一次到处生效。
export type Face = { emoji: string; tint: string; blob?: Blob };

/// 用户没有 tint 字段（他不是联系人），固定用这个灰蓝
export const ME_TINT = "oklch(0.72 0.02 250)";

const ME_ID = "__me_avatar__";

export const faceOf = (c: Contact): Face => ({ emoji: c.emoji, tint: c.tint, blob: c.avatar });

/// 从原图正中裁一个正方形，缩到 192。
///
/// ⚠️ **头像是拷贝，不是对相册那张图的引用。**
/// 这和 photos/store 里「图只存一份、别处存 id」那条是反的，是故意的：
/// 那条防的是同一张图散落三份、改一处漏两处；头像是从原图裁出来的**另一张**图，
/// 而且它得比来源活得久——把那张照片从相册删了，头像不该跟着变空白。
///
/// 缩到 192 也不只是省空间：一条动态底下三十条评论就是三十个头像，
/// 拿 1280 的原图去画 20px 的圆，每个都要解码一次整张大图。
export async function cropSquare(src: Blob, size = 192): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("这个浏览器画不了图");
  }
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const out = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
  if (!out) throw new Error("裁不动这张图");
  return out;
}

/// 用户自己的头像存在 photos 表里一条固定 id 的记录上。
/// `saved: false` 所以不会出现在任何相册里——它属于这台手机，不属于哪段关系。
export async function saveMeAvatar(blob: Blob): Promise<void> {
  const row: Photo = {
    id: ME_ID,
    contactId: PHONE_SCOPE,
    blob,
    w: 192,
    h: 192,
    from: "me",
    saved: false,
    at: Date.now(),
  };
  await put("photos", row);
}

export const clearMeAvatar = () => remove("photos", ME_ID);

/// 用户这张脸。
///
/// ⚠️ 刷新信号走 `settings.userAvatarAt` 这个时间戳。settings 本来就流到了
/// 每个要画头像的组件，换头像时它一变，几处一起重读。
/// 不这么做就得单开一个全局 store，或者把 blob 顺着好几套 props 穿下去。
export function useMe(settings: Settings): Face {
  const [blob, setBlob] = useState<Blob | undefined>(undefined);
  const at = settings.userAvatarAt;

  useEffect(() => {
    if (!at) {
      setBlob(undefined);
      return;
    }
    let alive = true;
    void get<Photo>("photos", ME_ID).then((row) => {
      if (alive) setBlob(row?.blob);
    });
    return () => {
      alive = false;
    };
  }, [at]);

  return { emoji: settings.userEmoji, tint: ME_TINT, blob };
}

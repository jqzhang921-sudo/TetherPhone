"use client";
import { useEffect, useState } from "react";
import { get, put, remove } from "@/lib/db/idb";
import { PHONE_SCOPE, type Photo } from "@/lib/photos/store";

/// 挂在某个联系人身上的大图：聊天背景、主页横幅。
///
/// ⚠️ **图不放 Contact 记录里。** 头像那种小图可以（3KB），这些不行——
/// 铺满一屏就是几百 KB，而 contacts 表启动时 getAll 全量加载，
/// 挂上去等于每次开机把所有背景图和横幅都读出来。
/// 图进 photos 表（固定 id、`saved:false` 所以不进相册），
/// Contact 上只留一个时间戳当「有没有设过 + 换没换」的信号。
///
/// ⚠️ 和头像一样**存的是图本身，不是相册里那张的 id**：
/// 把原图从相册删掉，背景和横幅不该跟着变空白。
export type ImageKind = "chatbg" | "banner";

export const imageIdOf = (kind: ImageKind, contactId: string) => `__${kind}_${contactId}`;

export async function saveContactImage(
  kind: ImageKind,
  contactId: string,
  blob: Blob,
  w: number,
  h: number,
) {
  const row: Photo = {
    id: imageIdOf(kind, contactId),
    contactId: PHONE_SCOPE,
    blob,
    w,
    h,
    from: "me",
    saved: false,
    at: Date.now(),
  };
  await put("photos", row);
}

export const clearContactImage = (kind: ImageKind, contactId: string) =>
  remove("photos", imageIdOf(kind, contactId));

export const readContactImage = (kind: ImageKind, contactId: string) =>
  get<Photo>("photos", imageIdOf(kind, contactId));

/// 拿到一个能塞进 background/src 的临时 URL。
///
/// ⚠️ `at` 是刷新信号（Contact 上那个时间戳）。换了图它一变，这里重读；
/// 没设过是 undefined，直接给 null。
/// URL 在卸载和换图时都要 revoke，不然翻几个人的主页就攒一堆解不掉的图。
export function useContactImage(
  kind: ImageKind,
  contactId: string,
  at: number | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!at || !contactId) {
      setUrl(null);
      return;
    }
    let made: string | null = null;
    let alive = true;
    void readContactImage(kind, contactId).then((row) => {
      if (!row?.blob || !alive) return;
      made = URL.createObjectURL(row.blob);
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [kind, contactId, at]);

  return url;
}

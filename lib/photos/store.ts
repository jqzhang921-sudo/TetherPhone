"use client";
import { getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";

/// 相册。
///
/// **图存在这里，消息只存 id。** 一张图可能同时出现在聊天、相册、日记里，
/// 各存一份的话改一处得改三处，删一处剩两份孤儿。
///
/// `saved` 是「收进相册了没」：聊天里发过的图都在这张表里（不然气泡渲染不出来），
/// 但相册只显示 saved 的那些——收不收由人决定，和"发生过"是两回事。
export type Photo = {
  id: string;
  contactId: string;
  blob: Blob;
  w: number;
  h: number;
  from: "me" | "them";
  saved: boolean;
  at: number;
};

export async function loadPhotos(contactId: string): Promise<Photo[]> {
  const rows = await getAllBy<Photo>("photos", contactId);
  return rows.sort((a, b) => b.at - a.at);
}

export const savePhoto = (p: Photo) => put("photos", p);
export const deletePhoto = (id: string) => remove("photos", id);

/// 单条消息最多几张。不是洁癖——每张都要 base64 塞进请求体，
/// 六张就已经是几兆的报文了。
export const MAX_PER_MESSAGE = 6;

/// 压到能用的尺寸再存。
///
/// 手机随手一张就是三五兆，原样存进 IndexedDB 又原样 base64 发给模型，
/// 一条消息能撑到十几兆。1280 长边 + JPEG 0.82 通常落在 150~400KB，
/// 模型看得清，存得下，发得动。
export async function shrink(file: File, max = 1280, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d");
  if (!ctx) throw new Error("这个浏览器画不了图");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const blob = await new Promise<Blob | null>((res) =>
    cvs.toBlob(res, "image/jpeg", quality),
  );
  if (!blob) throw new Error("压不动这张图");
  return { blob, w, h };
}

/// 发给模型时要的形状。OpenAI 那套多模态格式就是 data URL。
export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error ?? new Error("读不出这张图"));
    fr.readAsDataURL(blob);
  });
}

/// 壁纸这类「属于这台手机、不属于某段关系」的图，用这个作用域。
/// 和音乐曲库同一个道理，也不会混进任何联系人的相册。
export const PHONE_SCOPE = "_phone";

export function blankPhoto(contactId: string, from: Photo["from"]): Omit<Photo, "blob" | "w" | "h"> {
  return { id: newId(), contactId, from, saved: false, at: Date.now() };
}

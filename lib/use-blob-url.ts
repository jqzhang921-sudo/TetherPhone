"use client";
import { useEffect, useState } from "react";

/// Blob → 能塞进 <img src> 的临时 URL。
///
/// **必须 revoke。** 每个 createObjectURL 都在文档上挂一份引用，不释放的话
/// 图片数据一直留在内存里——相册翻几十张就能看出来。
///
/// ⚠️ **同一个 Blob 共用一个地址，按引用计数放；地址在渲染时就给出去。**
/// 头像挂到每段消息旁边以后，同一张脸同屏十来份。原来是各建各的地址、而且在 effect 里建——
/// 每个新挂上的头像第一帧都是 emoji，下一帧才换成图。2026-09-15 量过：她发一句、它回一句，
/// 它的头像先闪了两次 emoji（打字中那一行、回复那一行）。现在已经有人在用的图，
/// 新挂上的第一帧就是图。
///
/// ⚠️ **没人用了也晚一点再放。** 常见的是同一帧里「这个卸载、那个挂上」
/// （打字中那一行换成真消息那一行）：立刻 revoke 的话，新挂上的拿到的是一个失效的地址。
/// 渲染了却没挂上的（严格模式多渲染一遍、渲染被丢弃），也靠这个定时器收掉。
type Entry = { url: string; refs: number; timer: number | null };

const shared = new WeakMap<Blob, Entry>();
const GRACE = 10_000;

function releaseLater(blob: Blob, e: Entry) {
  if (e.timer !== null) return;
  e.timer = window.setTimeout(() => {
    e.timer = null;
    if (e.refs > 0) return;
    URL.revokeObjectURL(e.url);
    if (shared.get(blob) === e) shared.delete(blob);
  }, GRACE);
}

function peek(blob: Blob): string {
  let e = shared.get(blob);
  if (!e) {
    e = { url: URL.createObjectURL(blob), refs: 0, timer: null };
    shared.set(blob, e);
    // 先挂上定时器：这次渲染真挂上了，下面的 effect 会把它取消
    releaseLater(blob, e);
  }
  return e.url;
}

export function useBlobUrl(blob: Blob | null | undefined) {
  const url = blob && typeof window !== "undefined" ? peek(blob) : null;
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!blob || !url) return;
    const e = shared.get(blob);
    if (!e || e.url !== url) {
      // 渲染到挂上之间隔得太久，那个地址已经放掉了：再渲染一次，拿新的
      rerender((n) => n + 1);
      return;
    }
    e.refs += 1;
    if (e.timer !== null) {
      window.clearTimeout(e.timer);
      e.timer = null;
    }
    return () => {
      e.refs -= 1;
      if (e.refs <= 0) releaseLater(blob, e);
    };
  }, [blob, url]);

  return url;
}

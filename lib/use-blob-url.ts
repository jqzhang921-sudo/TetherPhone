"use client";
import { useEffect, useState } from "react";

/// Blob → 能塞进 <img src> 的临时 URL。
///
/// **必须 revoke。** 每个 createObjectURL 都在文档上挂一份引用，不释放的话
/// 图片数据一直留在内存里——相册翻几十张就能看出来。
export function useBlobUrl(blob: Blob | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

"use client";
import { useEffect, useState } from "react";
import { PhotoImg } from "./photo-img";
import type { Photo } from "@/lib/photos/store";

/// 看大图。聊天里点图片和相册里点缩略图进的是同一个。
export function PhotoViewer({
  photo,
  onClose,
  onSave,
  onDelete,
}: {
  photo: Photo;
  onClose: () => void;
  /// 传了才显示「收进相册」。已经收过的不传。
  onSave?: () => void;
  onDelete?: () => void;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col"
      style={{
        background: "oklch(0.08 0 0 / 0.94)",
        opacity: entered ? 1 : 0,
        transition: "opacity 220ms var(--ease-ios)",
      }}
    >
      <button className="flex-1 min-h-0 grid place-items-center px-3" onClick={onClose}>
        <PhotoImg
          photo={photo}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </button>

      <div className="shrink-0 flex items-center justify-center gap-6 pb-6 pt-3 text-[14px]">
        <button onClick={onClose} style={{ color: "oklch(0.85 0 0)" }}>
          关掉
        </button>
        {onSave && (
          <button onClick={onSave} style={{ color: "oklch(0.92 0 0)" }}>
            收进相册
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => {
              // 删的是原图。聊天里引用它的气泡会变成一个空框——
              // 这是对的，那条消息确实发生过，只是图没了。
              if (!window.confirm("删掉这张？聊天里引用它的地方会空出来。")) return;
              onDelete();
            }}
            style={{ color: "oklch(0.65 0.19 25)" }}
          >
            删掉
          </button>
        )}
      </div>
    </div>
  );
}

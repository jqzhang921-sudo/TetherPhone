"use client";
import { useBlobUrl } from "@/lib/use-blob-url";
import type { Face } from "@/lib/os/avatar";

/// 画一张脸。有图用图，没图退回 emoji + 底色。
///
/// `ring` 是叠在一起时那圈描边（播放页、音乐组件里两个人挨着放），
/// 颜色跟着玻璃走，所以换壁纸时描边也跟着变。
export function Avatar({
  face,
  size = 44,
  ring = false,
  className = "",
  style,
}: {
  face: Face;
  size?: number;
  ring?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const url = useBlobUrl(face.blob);
  return (
    <span
      className={`shrink-0 grid place-items-center rounded-full overflow-hidden ${
        ring ? "ring-2" : ""
      } ${className}`}
      style={{
        width: size,
        height: size,
        background: face.tint,
        // emoji 撑到圆的一半左右，各个尺寸下比例才一致
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        ...(ring ? { ["--tw-ring-color" as string]: "var(--glass-tint)" } : null),
        ...style,
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        face.emoji
      )}
    </span>
  );
}

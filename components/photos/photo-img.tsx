"use client";
import { useBlobUrl } from "@/lib/use-blob-url";
import type { Photo } from "@/lib/photos/store";

export function PhotoImg({
  photo,
  className,
  style,
}: {
  photo: Photo | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  const url = useBlobUrl(photo?.blob);
  if (!photo) {
    // 图被删了但引用还在。留个占位，别让气泡塌成一条缝——
    // 那种"少了一块"比一个明确的空框更让人以为是 bug。
    return (
      <span
        className={className}
        style={{ ...style, background: "oklch(0.5 0 0 / 0.15)", display: "block" }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url ?? undefined}
      alt=""
      className={className}
      style={style}
      draggable={false}
    />
  );
}

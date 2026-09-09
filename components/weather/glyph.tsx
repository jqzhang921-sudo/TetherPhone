import { sceneOf } from "@/lib/weather/wmo";

/// 逐时和逐日那一排的小图标。
///
/// **不用 emoji。** emoji 的样子由系统决定——同一段代码在 iPhone 上是苹果那套
/// 立体贴纸，在安卓上是另一套，在 Windows 上又是一套，和界面其它部分永远不搭。
/// 画成线稿就永远是我们要的那一套。
export function Glyph({ code, day = true, size = 22 }: { code: number; day?: boolean; size?: number }) {
  const scene = sceneOf(code);
  const s = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const cloud = <path d="M7.5 17.5h8.2a3.3 3.3 0 0 0 .3-6.6 4.8 4.8 0 0 0-9.1-1.1 3.4 3.4 0 0 0 .6 7.7z" />;

  if (scene === "clear")
    return day ? (
      <svg {...s}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
      </svg>
    ) : (
      <svg {...s}>
        <path d="M19.5 14.8A8 8 0 0 1 9.2 4.5a8 8 0 1 0 10.3 10.3z" />
      </svg>
    );

  if (scene === "cloudy")
    return (
      <svg {...s}>
        {day ? <circle cx="8" cy="8" r="2.6" /> : <path d="M10.5 5.5a4 4 0 0 0 4.6 4.6 4 4 0 1 1-4.6-4.6z" />}
        {cloud}
      </svg>
    );

  if (scene === "overcast")
    return (
      <svg {...s}>
        <path d="M5.5 13.5a3.2 3.2 0 0 1 1.6-6 4.6 4.6 0 0 1 8.4-1" />
        {cloud}
      </svg>
    );

  if (scene === "fog")
    return (
      <svg {...s}>
        <path d="M4 9h13M6.5 12.5h13M4 16h11M8 19.5h10" />
      </svg>
    );

  if (scene === "snow")
    return (
      <svg {...s}>
        <path d="M7.5 15h8.2a3.3 3.3 0 0 0 .3-6.6 4.8 4.8 0 0 0-9.1-1.1A3.4 3.4 0 0 0 7.5 15z" />
        <path d="M9 18.5v.01M12 20.5v.01M15 18.5v.01" />
      </svg>
    );

  if (scene === "thunder")
    return (
      <svg {...s}>
        <path d="M7.5 14.5h8.2a3.3 3.3 0 0 0 .3-6.6 4.8 4.8 0 0 0-9.1-1.1 3.4 3.4 0 0 0 .6 7.7z" />
        <path d="M12.6 15.5 10.4 19h3.2L11.4 22" />
      </svg>
    );

  return (
    <svg {...s}>
      <path d="M7.5 14.5h8.2a3.3 3.3 0 0 0 .3-6.6 4.8 4.8 0 0 0-9.1-1.1 3.4 3.4 0 0 0 .6 7.7z" />
      <path d="M9 17.5 8.2 20M12 17.5l-.8 2.5M15 17.5l-.8 2.5" />
    </svg>
  );
}

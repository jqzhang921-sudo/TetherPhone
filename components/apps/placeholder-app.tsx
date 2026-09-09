import type { AppDef } from "@/lib/apps/registry";

/// 没做完的入口打开后是这个。
/// **不画假界面** —— 假的列表和假的数据会让人分不清"还没做"和"坏了"，
/// 而且自己看久了也会当它已经做完。
export function PlaceholderApp({ app }: { app: AppDef }) {
  return (
    <div className="flex-1 grid place-items-center px-10 text-center">
      <div className="anim-rise">
        <div
          className="glass-icon mx-auto grid place-items-center rounded-[22px] w-[76px] h-[76px] mb-5"
          style={{ color: app.tint }}
        >
          {app.icon}
        </div>
        <p className="text-[15px] mb-2" style={{ color: "var(--ink)" }}>
          {app.name}还没做
        </p>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          图标先占着位子。
          <br />
          壳子稳了再一个个填进来。
        </p>
      </div>
    </div>
  );
}

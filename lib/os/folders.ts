/// 桌面上的文件夹。
///
/// 它在网格里和一个图标一样大、一样能拖，只是点开是一叠 app 而不是一个 app。
///
/// ⚠️ **合并必须是一个明确的动作，不能靠"拖到另一个图标上"猜。**
/// iOS 那套靠悬停时长区分"换位"和"合并"——没有那个延迟的话，
/// 每一次换位都会变成一次误合并，而合并之后要拆开又得点开文件夹再拖出来。
/// 这里的规矩是：**拖到文件夹上 = 放进去，拖到别的东西上 = 换位**，
/// 新建文件夹是编辑态里的一个按钮。两种结果各自对应一种目标，不会猜错。
export type Folder = { key: string; name: string; apps: string[] };

export const FOLDER_PREFIX = "f:";
export const isFolder = (id: string) => id.startsWith(FOLDER_PREFIX);
export const folderKey = (id: string) => id.slice(FOLDER_PREFIX.length);

/// 存成 `key|名字|app1,app2` 用分号隔开。
/// 名字里不能有 `|` 和 `;`——改名时就地清掉，别等到读的时候才发现整行错位。
export const cleanName = (s: string) => s.replace(/[|;]/g, "").trim().slice(0, 12);

export function parseFolders(s: string): Folder[] {
  const out: Folder[] = [];
  for (const chunk of s.split(";")) {
    if (!chunk.trim()) continue;
    const [key, name, apps] = chunk.split("|");
    if (!key) continue;
    out.push({
      key: key.trim(),
      name: (name ?? "").trim() || "文件夹",
      apps: (apps ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    });
  }
  return out;
}

/// ⚠️ **空文件夹不写回去。** 最后一个 app 被拖出来之后它就该消失——
/// 留着一个点开什么都没有的方块，比没有更让人困惑。
export const serializeFolders = (fs: Folder[]) =>
  fs
    .filter((f) => f.apps.length > 0)
    .map((f) => `${f.key}|${cleanName(f.name) || "文件夹"}|${f.apps.join(",")}`)
    .join(";");

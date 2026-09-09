"use client";

/// IndexedDB 薄封装，没有依赖。
///
/// **为什么不用 localStorage**：上限 5–10MB，一张手机照片就吃掉大半；
/// 而且它是同步 API，读写大数据会卡住界面。相册一做就装不下，
/// 所以趁数据还是空的时候换过来——晚了就是数据迁移。
///
/// ⚠️ iOS Safari 对网页写入的存储有七天上限：用户七天没打开就清掉。
/// **加到主屏幕之后不受这条限制。** 所以引导「添加到主屏幕」是必做的一步，
/// 导出备份（lib/os/backup.ts）是兜最坏情况的那一层。

const DB_NAME = "tether";
const DB_VERSION = 1;

export const STORES = [
  "contacts",
  "messages",
  "photos",
  "diary",
  "letters",
  "memory",
  "notes",
] as const;
export type StoreName = (typeof STORES)[number];

/// 除了 contacts 自己，每张表都挂在某个联系人下——这是整个数据模型的地基。
/// 需求里所有「双方」「每个人」指的都是它。
export type Row = { id: string; contactId?: string };

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("这个浏览器没有 IndexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: "id" });
        if (name !== "contacts") {
          store.createIndex("contactId", "contactId", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("打不开数据库"));
  });
  return handle;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = body(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("数据库操作失败"));
      }),
  );
}

export async function getAll<T extends Row>(store: StoreName): Promise<T[]> {
  try {
    return await run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
  } catch {
    // 隐私模式 / 存储被禁：读不到就当空的，这一次会话照常能用。
    return [];
  }
}

export async function getAllBy<T extends Row>(
  store: StoreName,
  contactId: string,
): Promise<T[]> {
  try {
    return await run<T[]>(store, "readonly", (s) =>
      s.index("contactId").getAll(contactId) as IDBRequest<T[]>,
    );
  } catch {
    return [];
  }
}

export async function put<T extends Row>(store: StoreName, row: T): Promise<void> {
  try {
    await run(store, "readwrite", (s) => s.put(row));
  } catch {
    /* 存不下就只活在这次会话里，不该让功能本身失灵 */
  }
}

export async function putMany<T extends Row>(store: StoreName, rows: T[]): Promise<void> {
  if (!rows.length) return;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const s = tx.objectStore(store);
      for (const row of rows) s.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("批量写入失败"));
    });
  } catch {
    /* 同上 */
  }
}

export async function remove(store: StoreName, id: string): Promise<void> {
  try {
    await run(store, "readwrite", (s) => s.delete(id));
  } catch {
    /* 同上 */
  }
}

export async function clearStore(store: StoreName): Promise<void> {
  try {
    await run(store, "readwrite", (s) => s.clear());
  } catch {
    /* 同上 */
  }
}

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
/// ⚠️ **加新表要把这个数字 +1。** onupgradeneeded 只在版本变大时才跑，
/// 而它只创建缺的表、不动已有数据——所以升级对老用户是无损的。
/// 忘了加版本号的症状是「新表不存在」，而不是报错。
const DB_VERSION = 3;

export const STORES = [
  "contacts",
  "messages",
  "photos",
  "diary",
  "letters",
  "memory",
  "notes",
  "posts",
  "comments",
  "tracks",
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

/// 按 id 取一条。
///
/// 别用 getAll 再 find——那会把整张表的记录都读出来（相册里就是每一张图的
/// blob），只为拿其中一条。
export async function get<T extends Row>(store: StoreName, id: string): Promise<T | undefined> {
  try {
    // 和 getAll 一样吞掉隐私模式的错，别让读不到数据库变成整页白屏
    return await run<T | undefined>(store, "readonly", (s) => s.get(id) as IDBRequest<T | undefined>);
  } catch {
    return undefined;
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

/// 在**一个事务里**读了再写。
///
/// ⚠️ 这是「先占坑再干慢活」唯一靠得住的做法。`getAll` 之后再 `put` 是两个事务，
/// 中间那道缝里另一个调用能读到同一条数据——两边都以为自己抢到了。
/// IndexedDB 会把同一张表上重叠的 readwrite 事务排队，所以放进同一个事务就安全了。
///
/// `fn` 里**只能做 IDB 请求**，不能 await 别的 Promise：一旦让出微任务队列
/// 而事务里没有待处理的请求，事务就自动关了。
export function claim<T>(
  store: StoreName,
  fn: (s: IDBObjectStore, done: (v: T) => void, fail: (e: unknown) => void) => void,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        let out: T | null = null;
        fn(
          tx.objectStore(store),
          (v) => {
            out = v;
          },
          reject,
        );
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      }),
  ).catch(() => null);
}

export async function clearStore(store: StoreName): Promise<void> {
  try {
    await run(store, "readwrite", (s) => s.clear());
  } catch {
    /* 同上 */
  }
}

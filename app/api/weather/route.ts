/// 天气。全部走服务端，理由三条：
///
/// 1. **定位。** `navigator.geolocation` 只在 HTTPS（和 localhost）下可用。
///    她现在是从局域网 http 打开的，浏览器根本不给权限。所以拿不到坐标时
///    退回按公网出口 IP 定位——那是服务端才能干的事。
/// 2. **CORS。** ip-api 之类的接口不给浏览器发跨域头。
/// 3. 顺手把 open-meteo 那一大坨字段收拾成前端要的形状，别让 UI 去啃原始报文。
///
/// open-meteo 免 key、免费；ip-api 免 key。都不需要凭据，所以这个路由
/// 不碰任何密钥。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Place = { name: string; lat: number; lon: number };

/// ⚠️ **不能直接 Number(v)**：`Number(null)` 是 `0`，而 `Number.isFinite(0)`
/// 是 true——于是「没传经纬度」会被当成「传了 0,0」，跑去查几内亚湾的天气
/// （那儿常年 25 度 83% 湿度，看着还挺合理，所以特别难发现）。
const num = (v: string | null) => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/// 按城市名查坐标。open-meteo 自己的地理编码，中文能搜。
async function geocode(q: string): Promise<Place | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=zh&format=json`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    results?: { name: string; admin1?: string; latitude: number; longitude: number }[];
  };
  const hit = j.results?.[0];
  if (!hit) return null;
  return {
    // 「郑州 · 河南」比光一个「郑州」好认——同名的地方不少。
    name: hit.admin1 && hit.admin1 !== hit.name ? `${hit.name} · ${hit.admin1}` : hit.name,
    lat: hit.latitude,
    lon: hit.longitude,
  };
}

/// 按公网出口 IP 定位。
///
/// ⚠️ **这定的是网络出口，不是人。** 实测同一个 IP，三家给的位置能差七百公里
/// （ipwho.is 说上海、geojs 说郑州附近）。所以：
/// - 串三家，谁先成谁算，单家挂了不至于整个天气打不开
/// - 返回时**标明这是猜的**，界面上要让人一眼看出来并能改
///   ——装作定准了，比明说猜的更糟
async function byIp(): Promise<Place | null> {
  // ⚠️ **顺序有讲究**：只有 ip-api 支持中文地名（lang=zh-CN），所以它排第一。
  // 另外两家是 HTTPS 兜底，名字回英文——拿到英文名总比整个天气打不开强。
  const tries: (() => Promise<Place | null>)[] = [
    async () => {
      const r = await fetch(
        "http://ip-api.com/json/?fields=status,regionName,city,lat,lon&lang=zh-CN",
        { cache: "no-store" },
      );
      const j = (await r.json()) as {
        status?: string;
        city?: string;
        regionName?: string;
        lat?: number;
        lon?: number;
      };
      if (j.status !== "success" || j.lat == null || j.lon == null) return null;
      return { name: j.city || j.regionName || "这儿", lat: j.lat, lon: j.lon };
    },
    async () => {
      const r = await fetch("https://ipwho.is/?fields=success,city,region,latitude,longitude", {
        cache: "no-store",
      });
      const j = (await r.json()) as {
        success?: boolean;
        city?: string;
        region?: string;
        latitude?: number;
        longitude?: number;
      };
      if (!j.success || j.latitude == null || j.longitude == null) return null;
      return { name: j.city || j.region || "这儿", lat: j.latitude, lon: j.longitude };
    },
    async () => {
      const r = await fetch("https://get.geojs.io/v1/ip/geo.json", { cache: "no-store" });
      const j = (await r.json()) as { city?: string; region?: string; latitude?: string; longitude?: string };
      const la = Number(j.latitude);
      const lo = Number(j.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
      return { name: j.city || j.region || "这儿", lat: la, lon: lo };
    },
  ];

  for (const attempt of tries) {
    try {
      const hit = await attempt();
      if (hit) return hit;
    } catch {
      // 这一家不行就换下一家。三家全挂才算定不到。
    }
  }
  return null;
}

/// 反查坐标属于哪儿。浏览器给的是经纬度，屏幕上要显示地名。
///
/// ⚠️ **open-meteo 的地理编码只能正查，不能反查**——喂 latitude/longitude
/// 给它会直接报「expected type 'String' at path 'name'」。用 bigdatacloud，
/// 免 key、中文可用。查不到就退回坐标，别硬编一个地名骗人。
async function reverse(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
      { cache: "no-store" },
    );
    const j = (await r.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
    };
    return j.city || j.locality || j.principalSubdivision || `${lat.toFixed(1)}, ${lon.toFixed(1)}`;
  } catch {
    return `${lat.toFixed(1)}, ${lon.toFixed(1)}`;
  }
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  let place: Place | null = null;

  const lat = num(p.get("lat"));
  const lon = num(p.get("lon"));
  const q = p.get("q")?.trim();

  // 位置是怎么来的。界面要按这个决定说不说「这是猜的」。
  let source: "query" | "coords" | "ip" = "ip";

  try {
    if (q) {
      source = "query";
      place = await geocode(q);
    } else if (lat != null && lon != null) {
      source = "coords";
      place = { name: await reverse(lat, lon), lat, lon };
    } else {
      place = await byIp();
    }
  } catch (e) {
    return Response.json(
      { error: `定位失败：${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  if (!place) {
    return Response.json({ error: q ? `没找到「${q}」` : "定不到位置" }, { status: 404 });
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
    "&forecast_days=6&timezone=auto";

  let raw: {
    current: Record<string, number>;
    hourly: { time: string[]; temperature_2m: number[]; weather_code: number[] };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    raw = await r.json();
  } catch (e) {
    return Response.json(
      { error: `取天气失败：${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // 逐时只留「从现在往后」的 24 条——已经过去的小时对人没用，
  // 但 open-meteo 是从当天 0 点给的。
  const now = Date.now();
  const hourly = raw.hourly.time
    .map((t, i) => ({
      t,
      temp: Math.round(raw.hourly.temperature_2m[i]),
      code: raw.hourly.weather_code[i],
    }))
    .filter((h) => new Date(h.t).getTime() >= now - 30 * 60_000)
    .slice(0, 24);

  return Response.json({
    place: place.name,
    source,
    lat: place.lat,
    lon: place.lon,
    current: {
      temp: Math.round(raw.current.temperature_2m),
      feels: Math.round(raw.current.apparent_temperature),
      humidity: Math.round(raw.current.relative_humidity_2m),
      wind: Math.round(raw.current.wind_speed_10m),
      code: raw.current.weather_code,
      day: raw.current.is_day === 1,
    },
    hourly,
    daily: raw.daily.time.map((d, i) => ({
      date: d,
      code: raw.daily.weather_code[i],
      max: Math.round(raw.daily.temperature_2m_max[i]),
      min: Math.round(raw.daily.temperature_2m_min[i]),
    })),
  });
}

"use strict";

function overnightScenario(change, foreignNet, dayVolume, nightVolume) {
  const total = dayVolume + nightVolume;
  if (![change, foreignNet, dayVolume, nightVolume].every(Number.isSafeInteger)
      || dayVolume <= 0 || nightVolume <= 0) {
    throw new Error("夜盤資料不完整");
  }
  const ratio = nightVolume / total;
  const strength = nightVolume * 10 < total * 3 ? "參考價值低"
    : nightVolume * 10 > total * 4 ? "強訊號" : "一般訊號";
  const flow = foreignNet >= 1000 ? "外資明顯偏多" : foreignNet <= -1000 ? "外資明顯偏空"
    : foreignNet < 0 ? "外資小幅偏空" : foreignNet > 0 ? "外資小幅偏多" : "外資多空持平";
  let scenario = 0;
  if (change > 0 && foreignNet >= 1000) scenario = 1;
  if (change > 0 && foreignNet < 0) scenario = 2;
  if (change < 0 && foreignNet < 0) scenario = 3;
  if (change < 0 && foreignNet >= 1000) scenario = 4;
  return { total, ratio, strength, flow, scenario };
}

const overnightTitles = [
  "未形成四種劇本",
  "劇本一 · 偏向開高，觀察能否續漲",
  "劇本二 · 偏向開高，留意高開低走",
  "劇本三 · 偏向開低，留意跌勢延續",
  "劇本四 · 偏向開低，留意早盤反彈",
];

async function fetchOvernight(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error("夜盤快照暫時無法取得");
  const snapshot = await response.json();
  for (const key of ["targetDate", "dayDate"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot[key])) throw new Error("夜盤日期格式錯誤");
  }
  overnightScenario(snapshot.nightChange, snapshot.foreignNet, snapshot.dayVolume, snapshot.nightVolume);
  return snapshot;
}

async function renderOvernight() {
  const panel = document.getElementById("taifexNight");
  if (!panel) return;
  const status = document.getElementById("taifexNightStatus");
  try {
    const local = "data/taifex-night.json";
    const raw = "https://raw.githubusercontent.com/james10394-bit/jc-stock-radar/main/data/taifex-night.json";
    // GitHub Pages may retain an older build after a scheduled data-only commit.
    const sources = location.hostname === "james10394-bit.github.io" ? [local, raw] : [local];
    const results = await Promise.allSettled(sources.map(fetchOvernight));
    const available = results.filter(result => result.status === "fulfilled").map(result => result.value);
    const data = available.sort((a, b) => b.targetDate.localeCompare(a.targetDate)).at(0);
    if (!data) throw new Error("等待期交所資料同步");

    const { total, ratio, strength, flow, scenario } =
      overnightScenario(data.nightChange, data.foreignNet, data.dayVolume, data.nightVolume);
    const clock = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short",
    }).format(new Date());
    const today = clock.slice(0, 10);
    const upcoming = data.targetDate > today || (data.targetDate === today && clock.slice(11, 16) < "09:00");
    const timing = data.targetDate < today ? "歷史盤前紀錄"
      : upcoming ? "待開盤" : "今日盤前紀錄";
    const number = new Intl.NumberFormat("zh-TW");
    const signed = new Intl.NumberFormat("zh-TW", { signDisplay: "exceptZero" });
    const percent = new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 2 });
    status.textContent = `${data.targetDate} 台股早盤 · ${timing}｜${data.dayDate} 日盤與當晚夜盤`;
    const title = document.getElementById("taifexNightScenario");
    title.textContent = overnightTitles[scenario] + (strength === "參考價值低" ? " · 低量參考" : "");
    const metrics = [
      ["TX 近月夜盤", `${number.format(data.nightClose)} 點（${signed.format(data.nightChange)} 點）`,
        `${data.contractMonth} 合約｜對比日盤結算 ${number.format(data.settlement)} 點`],
      ["TX 夜盤量比", `${percent.format(ratio)} · ${strength}`,
        `${number.format(data.nightVolume)} 口夜盤 ÷ ${number.format(total)} 口總量｜日盤 ${number.format(data.dayVolume)} 口`],
      ["TX 夜盤外資多空淨額", `${signed.format(data.foreignNet)} 口`, flow],
    ];
    const cards = metrics.map(([label, value, detail]) => {
      const card = document.createElement("div");
      card.className = "signal-card";
      const heading = document.createElement("small");
      heading.textContent = label;
      const amount = document.createElement("b");
      amount.textContent = value;
      const description = document.createElement("p");
      description.textContent = detail;
      card.append(heading, amount, description);
      return card;
    });
    document.getElementById("taifexNightMetrics").replaceChildren(...cards);
  } catch {
    status.textContent = "等待期交所夜盤行情與外資交易口數同步。";
  }
}

if (typeof module !== "undefined") module.exports = { overnightScenario };
if (typeof document !== "undefined") renderOvernight();

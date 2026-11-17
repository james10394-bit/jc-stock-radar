"""Publish the latest completed TX overnight session using TAIFEX reports."""
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo("Asia/Taipei")
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "taifex-night.json"
TAIFEX = (
    "https://www.taifex.com.tw/cht/3/",
    "https://www.bq888.taifex.com.tw/cht/3/",
)
MARKET = "futDailyMarketExcel"
FOREIGN = "futContractsDateAhExcel"
DATE = r"(\d{4}/\d{2}/\d{2})"


class Report(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.parts = []
        self.rows = []
        self.row = None
        self.cell = None
        self.feed(html)
        self.text = " ".join(" ".join(self.parts).split())

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag in ("th", "td") and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        self.parts.append(data)
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("th", "td") and self.cell is not None:
            self.row.append("".join("".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def report_date(report, pattern):
    match = re.search(pattern, report.text)
    if not match:
        raise ValueError("期交所報表缺少可核對的日期")
    return date.fromisoformat(match.group(1).replace("/", "-"))


def integer(value):
    return int(value.replace(",", "").replace("▲", "").replace("▼", ""))


def market_rows(report, volume_header):
    header_index = next(i for i, row in enumerate(report.rows)
                        if "契約" in row and volume_header in row)
    header = report.rows[header_index]
    volume_index = header.index(volume_header)
    monthly = {}
    for row in report.rows[header_index + 1:]:
        if len(row) > volume_index and row[0] == "TX" and re.fullmatch(r"\d{6}", row[1]):
            monthly[row[1]] = dict(zip(header, row))
        if len(row) > volume_index and "小計:" in row:
            volume = integer(row[volume_index])
            if monthly and volume > 0:
                return monthly, volume
            break
    raise ValueError("期交所報表缺少 TX 成交量小計")


def foreign_net(report, target):
    if report_date(report, r"日期\s*" + DATE) != target:
        raise ValueError("夜盤外資統計交易日尚未同步")
    for i, row in enumerate(report.rows):
        if row[:3] == ["1", "臺股期貨", "自營商"]:
            foreign = report.rows[i + 2]
            if len(foreign) == 7 and foreign[0] == "外資":
                long_count, short_count, net = (integer(foreign[index]) for index in (1, 3, 5))
                if long_count - short_count == net:
                    return net
            break
    raise ValueError("期交所報表缺少可核對的 TX 夜盤外資淨額")


def build_snapshot(night, day, foreign, now):
    target = market_date(night)
    day_date = night_start(night)
    if target <= day_date or target > day_date + timedelta(days=10):
        raise ValueError("夜盤歸屬日與開盤日不符")
    completed = datetime.combine(day_date + timedelta(days=1), time(5), TAIPEI)
    if now < completed:
        raise ValueError("夜盤尚未收盤")
    if report_date(day, r"日期[：:]\s*" + DATE) != day_date:
        raise ValueError("一般交易時段報表日期不符")
    day_session = DATE + r"\s+08:45\s*~\s*\d{2}:\d{2}\s+一般交易時段行情表"
    if report_date(day, day_session) != day_date:
        raise ValueError("一般交易時段與夜盤日期未對齊")

    night_quotes, night_volume = market_rows(night, "*成交量")
    day_quotes, day_volume = market_rows(day, "*一般交易時段成交量")
    for contract in sorted(night_quotes.keys() & day_quotes.keys()):
        try:
            settlement = integer(day_quotes[contract]["結算價"])
            close = integer(night_quotes[contract]["最後成交價"])
            change = integer(night_quotes[contract]["漲跌價"])
        except ValueError:
            continue
        if settlement > 0 and close > 0 and close - settlement == change:
            break
    else:
        raise ValueError("無法配對同一到期月份的夜盤收盤與日盤結算價")

    return {
        "targetDate": target.isoformat(),
        "dayDate": day_date.isoformat(),
        "nightEnd": completed.isoformat(),
        "contractMonth": contract,
        "dayVolume": day_volume,
        "nightVolume": night_volume,
        "settlement": settlement,
        "nightClose": close,
        "nightChange": change,
        "foreignNet": foreign_net(foreign, target),
    }


def fetch(endpoint, validate, **params):
    resource = endpoint + ("?" + urlencode(params) if params else "")
    for base in (*TAIFEX, TAIFEX[0]):
        request = Request(base + resource, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"})
        try:
            with urlopen(request, timeout=12) as response:
                report = Report(response.read().decode("utf-8-sig"))
            validate(report)
            return report
        except (OSError, ValueError, StopIteration) as exc:
            print(f"期交所報表 {base}{endpoint} 暫不可用：{exc}")
            last_error = exc
    raise RuntimeError(f"經重試仍無法取得有效期交所報表：{endpoint}") from last_error


def market_date(report):
    return report_date(report, r"日期[：:]\s*" + DATE)


def night_start(report):
    return report_date(report, DATE + r"\s+15:00\s*~\s*次日05:00\s+盤後交易時段行情表")


def main():
    now = datetime.now(timezone.utc).astimezone(TAIPEI)
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else None

    def check_night(report):
        target = market_date(report)
        if previous and target.isoformat() < previous["targetDate"]:
            raise ValueError("夜盤報表日期早於已保存的快照")
        night_start(report)
        market_rows(report, "*成交量")

    night = fetch(MARKET, check_night, marketCode=1, commodity_id="TX")
    target = market_date(night)
    if previous and target.isoformat() <= previous["targetDate"]:
        print(f"已保存 {previous['targetDate']} 夜盤，期交所尚未提供更新的完整快照。")
        return
    day_date = night_start(night)
    completed = datetime.combine(day_date + timedelta(days=1), time(5), TAIPEI)
    if now < completed:
        print(f"{target} 夜盤尚未收盤，等待下一次排程。")
        return

    def check_day(report):
        if market_date(report) != day_date:
            raise ValueError("一般交易時段報表日期不符")
        market_rows(report, "*一般交易時段成交量")

    day = fetch(MARKET, check_day, marketCode=0, commodity_id="TX", queryDate=day_date.strftime("%Y/%m/%d"))
    foreign = fetch(FOREIGN, lambda report: foreign_net(report, target))
    snapshot = build_snapshot(night, day, foreign, now)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"已更新 {snapshot['targetDate']} 開盤分析。")


if __name__ == "__main__":
    main()

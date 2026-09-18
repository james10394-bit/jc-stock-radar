# 台股法人技術分析站 · v2.0.0

這是一套可部署到 GitHub Pages 的台股盤後研究工具，整合臺灣證券交易所上市股票的三大法人資料、外資排行、本益比，以及自選股的 KD、布林通道、均線、支撐壓力與規則式操作區間。

## v2.0.0 新增內容

- 自選股近 7 個月份日線，自動保留最近 160 個交易日。
- KD（9,3,3）、MA5／MA10／MA20、布林通道（20日、2倍標準差）。
- 前 20 日高低點支撐與壓力。
- 分批買進觀察區、停損參考、分批賣出觀察區。
- 依均線、KD、近 5 日外資與布林位置產生「偏多觀察／區間等待／偏弱保守」。
- 外資、投信、自營商 5／10／20 日累計。
- 自選股快捷列與行動版介面。

所有價位均由固定公式計算，只是研究參考，不是獲利保證或個別投資建議。

## 上傳與啟用

1. 解壓縮 ZIP，把資料夾裡所有檔案上傳到 GitHub 儲存庫根目錄，包含隱藏的 `.github/workflows/update.yml`。
2. 到 **Settings → Actions → General → Workflow permissions**，選擇 **Read and write permissions** 並儲存。
3. 到 **Actions → Update TWSE data → Run workflow**，先手動執行一次。第一次會補齊約 20～30 個法人交易日與自選股歷史日線，時間會比日常更新久。
4. 到 **Settings → Pages → Build and deployment**，選 **Deploy from a branch**、`main`、`/(root)`。
5. 網站通常會出現在 `https://你的帳號.github.io/儲存庫名稱/`。

排程設定為台灣時間週一至週五 18:25 執行。盤中不更新，請以頁面顯示的「最近交易日」判斷資料日期。

## 修改自選股票

開啟 `data/watchlist.json`，把股票代號改成你要追蹤的上市股票：

```json
{
  "codes": ["2330", "2317", "2454", "2603", "2609", "2615"]
}
```

最多建議 30 檔。修改後到 Actions 手動執行一次，系統才會下載新加入股票的歷史日線。沒有加入自選清單的上市股票仍可查詢法人資料，但不會顯示完整 KD、布林與操作區間。

## 計算方式

| 項目 | 方法 |
| --- | --- |
| 外資及陸資 | 證交所 T86「外資及陸資（不含外資自營商）」欄位 |
| 三大法人 | 外資及陸資＋投信＋自營商官方資料 |
| KD | 9 日 RSV；K、D 平滑參數皆為 3，起始值 50 |
| 布林通道 | 20 日收盤平均 ± 2 倍母體標準差 |
| 支撐／壓力 | 不含最新日的前 20 個交易日最低／最高價 |
| 買進觀察區 | 支撐、布林下軌與 MA20 中較接近現價的有效區域 |
| 停損參考 | 前 20 日最低價再下移約 3%，並依台股跳動單位取整 |
| 賣出觀察區 | 前 20 日壓力或布林上軌中較接近現價者的上下區間 |
| 綜合判斷 | 收盤與 MA20、KD 方向、近 5 日外資、是否超出布林上軌 |

技術價格未做除權息還原。外資買進占比是成交資料比例，不是盤中委買委賣。上櫃股票不在此版本範圍。

## 資料來源

- [三大法人買賣超日報](https://www.twse.com.tw/zh/trading/foreign/t86.html)
- [個股日本益比](https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html)
- [個股日成交資訊](https://www.twse.com.tw/zh/trading/historical/stock-day.html)
- [TWSE OpenAPI](https://openapi.twse.com.tw/)

## 本地檢查

```sh
python3 scripts/update.py
python3 -m unittest discover -s tests
python3 -m http.server 8000
```

開啟 `http://localhost:8000`。直接雙擊 `index.html` 可能因瀏覽器安全限制無法讀取 JSON。

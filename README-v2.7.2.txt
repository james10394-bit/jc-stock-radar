JC Stock Radar 台股法人技術分析站 v2.7.2
多因子買進評估、成交量與上影線

解壓縮後，於 GitHub 的 main 分支根目錄上傳四個檔案：
index.html、app.js、risk-engine.js、intraday-ui.js。
另將 scripts/update.py、data/company-outlook.json 上傳至各自原有目錄。
不需要上傳本說明或測試，也不必更換工作流程或 market.json。
提交後至 Actions 確認 Pages 部署成功，再重開網站，頁首應顯示 v2.7.2。

首頁順序：當日外資買賣 → 代號搜尋 → 個股資料與交易分析 → 其他區塊。
模型滿分100：KD、EPS、月營收動能、布林通道、趨勢、外資各15分，價量與上影線10分。
70分以上且通過風險檢查才標記可評估新進，55～69分為中性觀察。
成交量比較前20交易日均量，1.5倍為放量門檻；上影線為上影長度除以當日高低價差。
帶量長上影、放量一日反轉、放量收黑等警訊優先於分數；放量突破可加分。
外資買賣使用已公布日資料，成交量不能用來辨識交易者身分。
月營收是營運動能的參考，並非公司財測。資料來源：
https://openapi.twse.com.tw/v1/opendata/t187ap05_L
https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O
本版評估為收盤資料篩選，分數不是上漲機率或下單訊號。

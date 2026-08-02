# 視覺題改革分享素材

這個資料夾提供教師研習、校內分享或跨 agent 建置時可直接使用的素材。

## 最快使用方式

在專案根目錄執行：

```powershell
pwsh -NoProfile -File ".\scripts\build-visual-sharing-pack.ps1"
```

輸出位置：

```text
sharing\generated\
```

其中包含：

- `視覺題六題示範.html`：可離線開啟的自含圖片預覽。
- `prompts\`：每題生圖交接包與不可交給 AI 的數學事實。
- `wayground-browser.json`：登入瀏覽器可使用的發布計畫。
- `visual-question-factory-package\`：可交給其他教師或 agent 的完整可攜包。
- `分享包清單.json`：版本、題數與發布狀態。

## 分享時建議順序

1. 先展示「文字很難講清楚」的題型。
2. 比較原卷裁圖、確定性繪圖、AI 情境合成三條產線。
3. 說明為什麼不能讓 AI 決定數字、數量與幾何關係。
4. 開啟六題示範 HTML。
5. 展示一題的 AI 背景、`visual-spec.json` 與最終 PNG。
6. 執行嚴格驗證，最後展示 Wayground browser plan。

講義見 [視覺題改革_講師講義.md](視覺題改革_講師講義.md)，可複製提示詞見 [可複製提示詞.md](可複製提示詞.md)。

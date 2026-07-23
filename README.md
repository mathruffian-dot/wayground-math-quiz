# Wayground Math Quiz Agent Toolkit

將 Word／PDF 數學試卷轉成可追溯、可驗證、圖片優先的 Wayground 測驗。專案同時提供：

- 跨代理人 `wayground-math-quiz` skill
- 平台中立的 `quiz.json` 規格
- Word／PDF 正規化、頁面渲染、裁圖與驗證 CLI
- Wayground 文字題 connector plan、圖片題 browser plan 與離線匯出
- 相依性極低的本機 MCP server
- Claude Code、Codex、Google AntiGravity 與 OpenCode 四端安裝腳本
- Codex plugin 封裝

本專案不是 Wayground／Quizizz 官方產品，也不包含任何商業題庫、學生資料或登入憑證。

## 核心原則

1. 原始試卷只讀，所有加工都在獨立 job 目錄完成。
2. `quiz.json` 是唯一題目真相來源；Wayground 不是唯一保存位置。
3. 複雜數學式、幾何圖、數線與表格優先保留為原始版面圖片。
4. 圖片內含選項時，Wayground 可點選選項固定為 `A/B/C/D`，並關閉答案洗牌。
5. 發布前必須通過嚴格驗證；發布後保存 URL、題數、設定與截圖證據。
6. 不保存 Cookie、session、瀏覽器 profile、API key 或學生個資。

## 系統需求

- Node.js 18+
- Python 3.10+ 與 Pillow
- Poppler 的 `pdftoppm`
- Word 輸入需 LibreOffice，或 Windows 上的 Microsoft Word
- 圖片題發布需使用者已登入 Wayground 的瀏覽器

檢查環境：

```powershell
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" doctor
```

## 安裝到四個 agent

```powershell
git clone https://github.com/mathruffian-dot/wayground-math-quiz.git
Set-Location ".\wayground-math-quiz"
pwsh -NoProfile -File ".\scripts\sync-four-agents.ps1"
```

預設安裝位置：

| Agent | 技能目錄 |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\skills\wayground-math-quiz` |
| Codex／ChatGPT App | `%USERPROFILE%\.codex\skills\wayground-math-quiz` |
| Google AntiGravity | `%USERPROFILE%\.gemini\config\skills\wayground-math-quiz` |
| OpenCode | `%USERPROFILE%\.config\opencode\skills\wayground-math-quiz` |

安裝後請重新啟動或重新載入 agent。完整說明見 [跨代理人安裝](docs/cross-agent-installation.md)。

若使用 chezmoi 管理多台電腦，見 [Chezmoi 自動安裝與升級](docs/chezmoi-installation.md)。

## 快速建立一份測驗

```powershell
$job = "D:\quiz-jobs\book1-unit1"

node ".\skills\wayground-math-quiz\scripts\quiz.mjs" init `
  --out $job `
  --title "七年級第一冊複習"

node ".\skills\wayground-math-quiz\scripts\quiz.mjs" ingest `
  --input "D:\sources\book1.pdf" `
  --out $job `
  --dpi 220
```

接著由 agent 檢視 `pages\page-*.png`，建立 `crop-plan.json`，再執行：

```powershell
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" crop --job $job
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" assemble --job $job --grade-start 7 --grade-end 7
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" validate --quiz "$job\quiz.json" --strict --report "$job\validation.json"
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" preview --quiz "$job\quiz.json" --out "$job\preview.html"
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" publish --adapter wayground-browser --quiz "$job\quiz.json" --out "$job\export\wayground-browser.json"
```

圖片題的瀏覽器發布步驟見 [browser-publishing.md](skills/wayground-math-quiz/references/browser-publishing.md)。

## 發布方式

| Adapter | 適用情境 |
|---|---|
| `wayground-mcp` | 目前 connector 能完整表達的文字選擇題 |
| `wayground-browser` | 題目圖片、方程式編輯器或 connector 未提供的功能 |
| `export-only` | 交給另一位教師或 agent 稍後發布 |

Wayground 的答案洗牌位於每次「分配／現在開始」的設定頁，可能預設開啟。圖片內已有 `A/B/C/D` 時，建立作業或遊戲前必須再次關閉「隨機出題」與「隨機播放答案」。

## 專案結構

```text
.
├─ AGENTS.md                         # 給其他 agent 的入口與固定規則
├─ docs/                             # 架構與跨代理人安裝說明
├─ examples/minimal-text-quiz/       # 無版權問題的最小驗證範例
├─ skills/wayground-math-quiz/       # 唯一核心 skill 來源
├─ plugins/wayground-math-quiz/      # Codex plugin 發布封裝
└─ scripts/
   ├─ sync-four-agents.ps1           # 安裝／更新四端 skill
   ├─ sync-plugin.ps1                # 將核心 skill 同步到 plugin
   └─ verify-repository.ps1          # 公開前與 CI 驗證
```

## 給其他 agent 的建置入口

新的 agent 應依序讀取：

1. [AGENTS.md](AGENTS.md)
2. [skills/wayground-math-quiz/SKILL.md](skills/wayground-math-quiz/SKILL.md)
3. [架構說明](docs/architecture.md)
4. 與當前任務相關的 `references/` 文件

若要修改技能，先改 `skills\wayground-math-quiz\`，再執行：

```powershell
pwsh -NoProfile -File ".\scripts\sync-plugin.ps1"
pwsh -NoProfile -File ".\scripts\verify-repository.ps1"
```

## 公開與隱私邊界

此 repo 只應包含程式、schema、文件與自行建立的範例。請勿提交：

- 原始商業題庫或其大批截圖
- 學生姓名、Email、作答紀錄
- Wayground Cookie、session、瀏覽器資料夾
- 本機絕對路徑、API key 或未公開端點
- 含私人帳號資訊的發布截圖

## 驗證

```powershell
pwsh -NoProfile -File ".\scripts\verify-repository.ps1"
```

驗證內容包括核心／plugin skill 樹狀雜湊一致、公開檔案敏感資訊掃描，以及最小範例的嚴格驗證與離線預覽。

## 授權

程式與文件採 [MIT License](LICENSE)。使用者仍須自行確認輸入試卷、圖片與題目的著作權及平台使用權限。

# 給其他 Agent 的建置指南

本文件描述一個全新 agent 如何理解、修改、驗證與發布本專案。

## 1. 建立上下文

依序讀取：

1. `AGENTS.md`
2. `skills/wayground-math-quiz/SKILL.md`
3. `docs/architecture.md`
4. 與任務直接相關的 `skills/wayground-math-quiz/references/*.md`

不要先掃描私人題庫、job 目錄或瀏覽器資料。

## 2. 檢查基線

```powershell
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" --help
node ".\skills\wayground-math-quiz\scripts\quiz.mjs" doctor
pwsh -NoProfile -File ".\scripts\verify-repository.ps1"
```

`doctor` 可能因缺少 Word、LibreOffice、Poppler 或 Pillow 而回報環境差異；repo 結構與範例驗證仍必須通過。

## 3. 修改規則

- 只修改 `skills\wayground-math-quiz\` 的核心版本。
- 保持 `SKILL.md` 簡潔，詳細規格放入一層深的 `references\`。
- 重複且脆弱的流程應放入 `scripts\`。
- 不增加 agent 特定的絕對路徑。
- 不將登入資訊或平台私有端點寫入程式。
- UI selector 不可永久硬編碼；瀏覽器流程使用當次 accessibility snapshot。

修改完成後：

```powershell
pwsh -NoProfile -File ".\scripts\sync-plugin.ps1"
pwsh -NoProfile -File ".\scripts\verify-repository.ps1"
```

## 4. 新增 CLI 能力

1. 在 `scripts\quiz.mjs` 增加命令與參數。
2. 確保不需要網路也能測試核心邏輯。
3. 若要提供給 MCP，同步加入 `mcp\server.mjs`。
4. 更新 `SKILL.md` 的流程與 `references\mcp-server.md`。
5. 加入無版權、無私人資料的範例或驗證案例。

## 5. 修改 schema

1. 先更新 `assets\quiz.schema.json`。
2. 更新 `references\quiz-schema.md`。
3. 更新 CLI validation。
4. 保留向後相容，或提升 `schemaVersion`。
5. 更新 `examples\minimal-text-quiz\quiz.json` 並執行嚴格驗證。

## 6. 發布 Wayground

在寫入外部平台前：

1. 確認使用者已授權發布。
2. `validate --strict` 必須為零錯誤。
3. 產生並檢查 `preview.html`。
4. 依題型選擇 `wayground-mcp` 或 `wayground-browser`。
5. 圖片題使用使用者已登入的瀏覽器。
6. 關閉題目與答案洗牌。
7. 未授權時，不建立班級作業、不啟動 live session。
8. 重新開啟資源並產生 publication evidence。

## 7. 公開發版

公開前執行：

```powershell
pwsh -NoProfile -File ".\scripts\verify-repository.ps1"
git status --short
git diff --cached
```

確認 staged files 不含：

- 本機絕對路徑
- Email、姓名、學生資料
- Cookie、token、API key
- 題庫原檔與來源截圖
- Wayground 私人發布證據

## 8. 完成標準

只有同時符合以下條件才算完成：

- 核心 skill 與 plugin mirror `HASH_OK`
- 最小範例 strict validation 為零錯誤、零警告
- 離線 preview 可產生
- 四端安裝腳本可執行且每端 `HASH_OK`
- 公開檔案敏感資訊掃描通過
- 文件足以讓未參與開發的 agent 從 repo 根目錄開始工作

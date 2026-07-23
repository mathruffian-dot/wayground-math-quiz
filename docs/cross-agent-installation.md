# 跨代理人安裝

同一份 `wayground-math-quiz` skill 可安裝到 Claude Code、Codex、Google AntiGravity 與 OpenCode。

## 自動安裝

在 repo 根目錄執行：

```powershell
pwsh -NoProfile -File ".\scripts\sync-four-agents.ps1"
```

腳本會：

1. 檢查核心 skill 必要檔案。
2. 建立缺少的 agent skill 根目錄。
3. 若舊版已存在，先移到時間戳記備份，不直接刪除。
4. 複製完整 skill。
5. 比較每個檔案的相對路徑與 SHA-256。
6. 回報每一端 `HASH_OK`。

自訂根目錄：

```powershell
pwsh -NoProfile -File ".\scripts\sync-four-agents.ps1" `
  -ClaudeRoot "D:\agent-data\claude\skills" `
  -CodexRoot "D:\agent-data\codex\skills" `
  -AntiGravityRoot "D:\agent-data\antigravity\skills" `
  -OpenCodeRoot "D:\agent-data\opencode\skills"
```

只檢查將執行的動作：

```powershell
pwsh -NoProfile -File ".\scripts\sync-four-agents.ps1" -WhatIf
```

## 預設目錄

| Agent | 預設技能根目錄 |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\skills` |
| Codex／ChatGPT App | `%USERPROFILE%\.codex\skills` |
| Google AntiGravity | `%USERPROFILE%\.gemini\config\skills` |
| OpenCode | `%USERPROFILE%\.config\opencode\skills` |

每個目錄下都會建立 `wayground-math-quiz\SKILL.md`。

## 手動安裝

若不使用腳本，將整個資料夾複製到 agent 的 skill root：

```powershell
Copy-Item -LiteralPath ".\skills\wayground-math-quiz" `
  -Destination "$env:USERPROFILE\.codex\skills" `
  -Recurse
```

不要只複製 `SKILL.md`。CLI、schema、MCP server、references 與 scripts 都是 skill 的必要部分。

## 重新載入

安裝或更新後：

1. 關閉並重新啟動 agent，或使用該 agent 的重新載入功能。
2. 確認技能列表中出現 `wayground-math-quiz`。
3. 使用下列提示測試：

```text
使用 $wayground-math-quiz 檢查目前環境是否能處理 PDF 圖片題。
```

4. Agent 應執行或建議執行：

```powershell
node "<skill-root>\wayground-math-quiz\scripts\quiz.mjs" doctor
```

## MCP 是可選的

四個 agent 即使不註冊 MCP，也能依 `SKILL.md` 直接執行 CLI。若 agent 支援本機 MCP，可將 command 指向：

```powershell
node "<skill-root>\wayground-math-quiz\mcp\server.mjs"
```

不同 agent 的 MCP 設定檔格式會變動，因此 repo 不修改使用者的全域 MCP 設定。詳細工具與安全邊界見 `skills/wayground-math-quiz/references/mcp-server.md`。

## 更新

```powershell
git pull
pwsh -NoProfile -File ".\scripts\sync-four-agents.ps1"
```

若更新失敗，腳本會保留原技能備份與失敗副本，不會靜默刪除現有版本。

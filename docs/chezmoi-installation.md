# Chezmoi 自動安裝與升級

`scripts/chezmoi-sync-wayground-math-quiz.ps1` 可作為 chezmoi 的輕量 bootstrap。

它不把四份 skill 全部存進 chezmoi，而是：

1. 將公開 repo clone 到 `%LOCALAPPDATA%\wayground-math-quiz`。
2. 每次執行時安全 fetch，並以 `--ff-only` 升級 `main`。
3. 執行 repo 內的 `scripts\sync-four-agents.ps1`。
4. 對 Claude Code、Codex、AntiGravity 與 OpenCode 逐檔驗證 SHA-256。

## 建議的 chezmoi 來源結構

```text
dot_local/bin/sync-wayground-math-quiz.ps1
run_after_sync-wayground-math-quiz.cmd.tmpl
```

`run_after` 內容：

```bat
@pwsh.exe -NoProfile -File "%USERPROFILE%\.local\bin\sync-wayground-math-quiz.ps1"
```

如此一來，新電腦第一次執行 `chezmoi apply` 會安裝；日後執行 `chezmoi update` 或 `chezmoi apply` 會檢查 GitHub 更新並同步四端。

## 安全行為

- 公開 repo 已存在本機修改時，不會覆蓋，會跳過 Git 升級。
- 已安裝 repo 暫時無法連線 GitHub時，沿用本機版本並繼續同步。
- 初次安裝且無法連線 GitHub時會停止，因為沒有可安全沿用的版本。
- 四端同步遇到舊版時會先建立時間戳記備份。
- 可設定 `WAYGROUND_MATH_QUIZ_HOME` 改變 repo 安裝位置。

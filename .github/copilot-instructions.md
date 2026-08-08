# Necokara 开发指令

## 工作方式

1. **先说行不行，再说做不做** — 对于每一条带疑问的指令，先分析可行性给出回答，再等待进一步指令。
2. **先说明方案再动手** — 重构或新增功能前先提方案，确认后再执行，执行后说明本次改动，如果是修复，请说明发生该bug的原因和修复策略。
3. **每次修改后跑 `npx tsc --noEmit` 检查** — 确保类型正确，无新错误。
4. **一个对话做一个任务** — 不一次性做多个，完成一个再下一个。
5. **渐进式开发** — 先跑通最小可运行版本，再逐步添加功能。

## 编码规范

- **语言**: TypeScript 严格模式。避免 `any`，优先用 `interface` 而非 `type`。
- **命名**: 文件名 kebab-case（如 `lyrics-editor.tsx`），类/类型 PascalCase，函数/变量 camelCase。
- **样式**: 使用普通 CSS，不引入 Sass/Less、CSS Modules 等预处理方案。颜色变量统一放在 `:root`。参照 `docs/DESIGN.md`
- **IPC 通信**: 主进程 `ipcMain.handle` + 渲染进程 `window.electron.ipcRenderer.invoke`（请求-响应模式）；或 `ipcMain.on` + `window.electron.ipcRenderer.send`（单向通知）。通道名定义在 `src/shared/ipc.ts` 中。
- **React**: 函数组件 + Hooks。避免 class 组件。组件文件后缀 `.tsx`。
- **状态管理**: MVP 阶段优先用 React Context + useReducer，暂不引入 Redux 等外部状态库。
- **不要用 PowerShell 批量处理文件** — 会导致中文编码损坏。
- **不要直接操作 DOM**，使用 React 的声明式方式。
- **不要**在主进程中直接 import 渲染进程的代码（反之亦然）。
- 及时清理**死代码**参与，适时和用户讨论**重构**重复代码等问题。
- 使用**英语**作为**注释**语言和辅助脚本**输出**语言（不是软件本体中的脚本）。

## 自动打轴链路（whisper 对齐）

- **后端**: `python/align.py` 用 stable-ts `model.align()` 把**完整歌词文本**强制对齐到人声。歌词文本 = `Lyrics.readingPrompt()`（所有 syllable.reading 拼接，含空格/换行/标点）
- **输出**: `charTimes`（键 = 原始 readingPrompt 字符偏移，值 = 对齐秒数）+ `segments`（`{start,end,text}`）。字符↔syllable 1:1 映射已实测成立（BPE encode/decode 无损往返）
- **映射**: 渲染侧 `applyCharTimesMap()` 按 readingPrompt 偏移重建 owner 表，每个 syllable 取**首字符**时间，单调 clamp；空白/换行/标点时间不依赖 whisper，由 `inferSeparatorTimes()` + `scanAllPunctuations()` 推断
- **不要**为 whisper 传关键词/提示词做条件化 —— `model.align()` 是歌词驱动的强制对齐，直接传完整 readingPrompt
- stable-ts 对日语按 BPE token 粒度切词（`split_words_by_space=False`），返回的词比我们的 syllable 更细/更粗/跨词都可能，统一由字符偏移映射兜底，不需要也不要去改它的分词

## 版本号约定

- 版本号唯一来源: `release/app/package.json` 中的 `version` 字段
- `src/project/project.ts` 的 `APP_VERSION` 通过 JSON import 自动同步
- 格式: 遵循 semver，完整格式 `主.次.补丁-预发布.序号`，如 `0.12.0-alpha.1`
- 预发布标签层级: `alpha.n` < `beta.n` < `rc.n` < 正式版（无标签）
- electron-updater 的 `allowPrerelease = true`，确保所有预发布版本之间也能检测更新

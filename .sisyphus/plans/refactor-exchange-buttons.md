# Refactor Exchange Switch Buttons - DRY #9

## TL;DR

> **Quick Summary**: 将 `src/app/funding/page.tsx` 中 4 个重复的交易所切换按钮（~70 行重复 JSX）重构为配置数组 + map 渲染，从 117 行减至 ~80 行。
>
> **Deliverables**: 
> - 重构后的 `src/app/funding/page.tsx`（配置驱动，无重复 JSX）
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - single file, single task

---

## Context

### Original Request
用户要求解决审计报告中 #9 问题：Exchange 切换按钮大量重复代码（4 个按钮结构完全相同，只有 icon path、颜色、名称不同）。

### Current State
`src/app/funding/page.tsx` 共 117 行，其中第 36-101 行（~66 行）是 4 个几乎相同的 `<button>` 元素，唯一差异：
- `onClick` 的 exchange id
- 颜色（blue/cyan/yellow/purple）
- SVG icon path
- 按钮文字名称
- 三元表达式判断是否显示"当前"标签

### Metis Review
N/A - 简单重构，无架构风险。

---

## Work Objectives

### Core Objective
消除 `page.tsx` 中的重复 JSX，用配置数组 + map 替代 4 个硬编码按钮，同时将链式三元表达式替换为配置驱动的组件查找。

### Concrete Deliverables
- `src/app/funding/page.tsx` — 重构为配置驱动

### Definition of Done
- [ ] 文件行数从 117 减少到 ~80
- [ ] 4 个按钮由单一 map 渲染
- [ ] 组件切换由配置查找替代链式三元表达式
- [ ] 视觉效果与重构前完全一致
- [ ] `npx tsc --noEmit` 通过

### Must Have
- 保留所有现有功能（按钮点击、高亮、"当前"标签、组件切换）
- 每个交易所的颜色、图标、名称可独立配置

### Must NOT Have (Guardrails)
- 不引入新的依赖或库
- 不改变任何视觉样式或行为
- 不修改其他文件

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (TypeScript)
- **Automated tests**: None（此文件无测试）
- **Agent-Executed QA**: YES

### QA Scenarios

```
Scenario: TypeScript 编译通过
  Tool: Bash
  Steps:
    1. cd "C:\Users\wnyan\Documents\Funding Monitor\hyperliquid"
    2. npx tsc --noEmit
  Expected Result: 0 errors
  Evidence: .sisyphus/evidence/task-1-tsc-check.txt

Scenario: 页面可正常启动
  Tool: Bash
  Steps:
    1. cd "C:\Users\wnyan\Documents\Funding Monitor\hyperliquid"
    2. 确认 dev server 可启动（检查进程或端口）
  Expected Result: 无编译错误
  Evidence: .sisyphus/evidence/task-1-dev-check.txt
```

---

## Execution Strategy

### Single Task (no parallelism needed)

```
Wave 1:
└── Task 1: Refactor page.tsx [quick]
```

---

## TODOs

- [x] 1. Refactor Exchange Switch Buttons in page.tsx

  **What to do**:
  - 定义 `ExchangeConfig` 接口，包含 `id`, `name`, `color`, `iconPath`, `component`
  - 创建 `EXCHANGE_CONFIG` 常量数组，包含 4 个交易所配置
  - 用 `EXCHANGE_CONFIG.map()` 替换 4 个硬编码 `<button>`
  - 用 `activeExchange.component` 替换链式三元表达式
  - 保持所有样式、行为、图标完全不变

  **Must NOT do**:
  - 不修改任何视觉样式（颜色值、间距、字体大小等）
  - 不引入新依赖
  - 不修改其他文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件重构，逻辑简单明确
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/funding/page.tsx` — 当前文件，需要重构的目标
  - `src/lib/types.ts:12-37` — `EXCHANGES` 常量可作为配置模式的参考

  **Acceptance Criteria**:
  - [ ] npx tsc --noEmit → 0 errors
  - [ ] 文件行数 ≤ 85 行
  - [ ] 4 个按钮由 map 渲染，无重复 JSX

  **QA Scenarios**:

  ```
  Scenario: TypeScript 编译通过
    Tool: Bash
    Preconditions: 文件已修改
    Steps:
      1. cd "C:\Users\wnyan\Documents\Funding Monitor\hyperliquid"
      2. npx tsc --noEmit 2>&1
    Expected Result: 0 errors, exit code 0
    Failure Indicators: 任何 TypeScript 编译错误
    Evidence: .sisyphus/evidence/task-1-tsc-check.txt

  Scenario: 文件行数显著减少
    Tool: Bash
    Preconditions: 文件已修改
    Steps:
      1. 统计 src/app/funding/page.tsx 行数
    Expected Result: 行数 ≤ 85（原 117 行）
    Evidence: .sisyphus/evidence/task-1-line-count.txt
  ```

  **Evidence to Capture**:
  - [ ] tsc 编译输出
  - [ ] 文件行数统计

  **Commit**: YES
  - Message: `refactor(funding): extract exchange switch buttons to config array`
  - Files: `src/app/funding/page.tsx`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  验证 page.tsx 行数 ≤ 85，无重复 JSX，TypeScript 编译通过，视觉效果不变。

- [ ] F2. **Code Quality Review** — `unspecified-high`
  运行 tsc --noEmit，检查无 `as any`、无未使用导入、无动态 Tailwind 类名问题。

---

## Commit Strategy

- **1**: `refactor(funding): extract exchange switch buttons to config array` — src/app/funding/page.tsx, npx tsc --noEmit

## Success Criteria

### Verification Commands
```bash
npx tsc --noEmit  # Expected: 0 errors
wc -l src/app/funding/page.tsx  # Expected: ≤ 85
```

### Final Checklist
- [ ] 无重复 JSX
- [ ] TypeScript 编译通过
- [ ] 文件行数减少 ≥ 25%
- [ ] 视觉/行为与重构前一致

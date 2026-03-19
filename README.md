# 🚀 Exchange Funding Rate Monitor

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-38bdf8)

**实时监控 Hyperliquid 和 Gate.io 资金费率的专业交易工具**

[在线演示](https://your-demo-link.com) · [报告问题](https://github.com/your-repo/issues) · [功能建议](https://github.com/your-repo/discussions)

</div>

---

## ✨ 核心功能

### 📊 多交易所支持
- **Hyperliquid**: 支持永续合约和 HIP-3 资产（股票、商品、ETF）
- **Gate.io**: 支持 655+ 永续合约，自动识别资产类别

### 📈 实时数据监控
- **自动刷新**: 每 30 秒自动更新数据
- **多维度排序**: 资金费率、价格、涨跌幅、成交量、持仓价值
- **智能筛选**: 按资产类别（Crypto、股票/指数、商品等）快速筛选

### 🎯 专业图表分析
- **K 线图表**: 支持日线、4小时线、1小时线切换
- **资金费率副图**: 年化预测费率可视化
- **30 天历史数据**: 完整的历史资金费率趋势

### 💡 智能统计
- **7天/30天统计**: 最高、最低、平均资金费率
- **年化计算**: 自动换算年化预测费率
- **持仓价值加权**: 基于持仓量的加权平均年化

---

## 🎨 界面预览

```
┌─────────────────────────────────────────────────────────────────┐
│  交易所资金费率监控                                               │
│  [Hyperliquid] [Gate.io]                                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │交易对数量│ │正资金费率│ │负资金费率│ │平均年化  │ │ USDT    │   │
│  │   655   │ │   423   │ │   232   │ │ +12.5%  │ │ Gate.io │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  [全部] [Crypto] [股票/指数] [商品] [其他]                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐ ┌─────────────────────────┐ │
│  │ 交易对列表                       │ │ K 线 + 资金费率图表      │ │
│  │ ─────────────────────────────── │ │                         │ │
│  │ BTC    69,832   -2.40%  +15.2% │ │    📈 [日线] [4h] [1h]   │ │
│  │ ETH    3,845    -3.15%  +8.7%  │ │                         │ │
│  │ SOL    178.5    -5.82%  +22.1% │ │                         │ │
│  │ ...                            │ │                         │ │
│  └─────────────────────────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js** | 16.x | React 框架，App Router |
| **React** | 19.x | UI 组件库 |
| **TypeScript** | 5.x | 类型安全 |
| **Tailwind CSS** | 4.x | 响应式样式 |
| **ECharts** | 6.x | 专业图表库 |
| **Docker** | - | 容器化部署 |

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn 或 bun

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/your-repo/exchange-funding-monitor.git
cd exchange-funding-monitor

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问 http://localhost:3000/funding
```

### Docker 部署

```bash
# 构建镜像
docker build -t funding-monitor .

# 运行容器
docker run -d -p 3000:3000 --name funding-monitor funding-monitor

# 或使用 Docker Compose
docker compose up -d --build
```

---

## 📁 项目结构

```
src/
├── app/
│   ├── funding/
│   │   └── page.tsx              # 资金费率监控主页面
│   ├── api/
│   │   └── gate/                 # Gate.io API 代理
│   └── page.tsx                  # 首页
├── components/
│   └── funding/
│       ├── FundingMonitor.tsx    # Hyperliquid 监控组件
│       ├── GateFundingMonitor.tsx# Gate.io 监控组件
│       └── *Chart.tsx            # 图表组件
├── lib/
│   ├── hyperliquid.ts            # Hyperliquid API 封装
│   └── gateio.ts                 # Gate.io API 封装
└── ...
```

---

## 🎯 支持的交易所

### Hyperliquid
| 功能 | 支持状态 |
|------|----------|
| 永续合约 | ✅ |
| HIP-3 资产 | ✅ |
| 实时资金费率 | ✅ |
| 历史数据 | ✅ |
| K 线图表 | ✅ |

### Gate.io
| 功能 | 支持状态 |
|------|----------|
| 永续合约 (USDT) | ✅ |
| 655+ 交易对 | ✅ |
| 资产类别筛选 | ✅ |
| 实时资金费率 | ✅ |
| 历史数据 | ✅ |
| K 线图表 | ✅ |

---

## 📊 资产类别分类

Gate.io 支持以下资产类别筛选：

- **Crypto**: 主流币、Meme、Layer 1/2、DeFi、AI、游戏、RWA
- **股票/指数**: BABA、TSLA、NVDA、SPY、QQQ、SPX500 等
- **商品**: XAU、XAG、XBR、PAXG、SLVON 等
- **其他**: 其他类型的永续合约

---

## 🔧 配置选项

### 环境变量

```env
# 可选：自定义 API 基础 URL
NEXT_PUBLIC_HYPERLIQUID_API=https://api.hyperliquid.xyz
NEXT_PUBLIC_GATE_API=https://api.gate.io/api/v4
```

### 数据刷新间隔

默认每 30 秒自动刷新数据。可在 `FundingMonitor.tsx` 中修改：

```typescript
const interval = setInterval(fetchData, 30000); // 30 秒
```

---

## 📈 计算公式

### 年化资金费率

```
年化费率 = 资金费率 × (24 / 结算周期小时) × 365 × 100
```

- **8小时结算**: `费率 × 3 × 365 × 100`
- **4小时结算**: `费率 × 6 × 365 × 100`

### 持仓价值加权平均

```
加权平均年化 = Σ(年化费率 × 持仓价值) / Σ(持仓价值)
```

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📝 更新日志

### v2.0.0 (2026-03-20)
- ✨ 新增 Gate.io 交易所支持
- ✨ 新增资产类别筛选功能
- ✨ 新增多交易所切换功能
- 🐛 修复年化费率计算公式
- 🐛 修复筛选后统计数据不更新的问题

### v1.5.0 (2026-03-19)
- ✨ 新增 K 线图表功能
- ✨ 新增多周期切换（日线/4h/1h）
- ✨ 新增资金费率副图
- 🐛 修复时间桶对齐问题

### v1.0.0 (2026-03-18)
- 🎉 首次发布
- ✨ Hyperliquid 资金费率监控
- ✨ 实时数据刷新
- ✨ 历史数据查询

---

## ⚠️ 免责声明

本工具仅供信息参考，不构成投资建议。加密货币交易存在重大风险，可能不适合所有投资者。过往表现不代表未来收益。请在做出任何交易决策前，进行自己的研究并考虑您的财务状况。

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐️ Star 支持一下！**

Made with ❤️ for crypto traders

</div>

# 🎲 欲罢不能 · 9 骰扩展包（在线版）

严格遵循 **[Can't Stop（欲罢不能）标准版规则骨架](https://www.ultraboardgames.com/cant-stop/game-rules.php)**，只改「骰子」与「路径表」两项：

|              | 标准版 | 本扩展 |
| ------------ | ------ | ------ |
| 骰子         | 4 骰，拆 2 组各 2 枚 | **9 骰，3 组各 3 枚** |
| 分法自由度   | 3 种拆法，玩家任选 | **280 种，每回合随机抽 5 种** |
| 每回合数字数 | 2 个 | **3 个** |
| 列           | 11 列（2~12） | **16 列（3~18）** |
| 临时路标     | 3 枚 | **3 枚** |
| 获胜         | 占 3 列 | **占 5 列** |

技术栈：原生前端（零构建）+ Express + **Turso**（libSQL）+ **Render** 部署。支持 AI 对战、房间码联机、排行榜。

---

## 一、规则

### 骰子：9 枚自由分组，从 280 种里抽 5 种

每回合摇 **9 枚**骰子。9 枚骰子任意分成 3 组、每组 3 枚，共 **280 种分法**。

**每回合从这 280 种里随机抽 5 种**给你选（不做预先过滤）：

- 抽到的 5 种里，**可能有些是走不了的**（腿已满 / 数字落在封锁列 / 已到顶），这些会显示为灰色禁用。
- 你只能在**能走的**里面选。若 5 种全都走不了 → 本回合立即 **BUST**。

不同骰面的分法数量差异很大：

```
骰子 4 4 4 4 4 4 4 4 4  → 只有 1 种组合 [12, 12, 12]（5 个选项全一样）
骰子 1 1 1 2 2 2 3 3 3  → 8 种组合，随机抽 5 种
骰子 1 2 3 4 5 6 1 2 3  → 约 20~30 种组合，随机抽 5 种
```

### 同一数字出现多次 = 前进多步

`10 + 10 + 10` → 10 号列**直接前进 3 格**，而且仍然只占 **1 条路标**。

这是本扩展与标准版的最大差异点：标准版 4 骰拆两对，两个数字相同就前进 2 格；这里 3 个数字相同就前进 3 格。

### 路标（腿）：3 枚，本回合最多推进 3 列

- 每回合 **3 枚临时路标** = 本回合最多能推进 **3 个不同的列**。
- 路标**不是消耗品**：同一列可以反复前进，不消耗新路标。
- 落在一个**还没有路标的列**上，就要占用一条新路标。
- 3 条腿用满后，摇出的数字若**都落不进已有列** → **爆掉**。

### 每回合流程

1. 摇 9 枚骰 → 从 280 种分法里**随机抽 5 种**。
2. 选一种能走的 → 引擎**强制**把 3 个数字全部落地（**能走的必须走**）：新列放腿、老列前进、重复数字多步。
3. 然后二选一：
   - **✋ 停止**：锁定本回合所得。
   - **🎲 继续摇**：重新摇骰 + 重新抽 5 种分法。若抽到的一种都推不动 → **BUST**，本回合新推进全部作废（永久进度不受影响）。

### 占领与胜利

- 某列走到**最后一格**并在停止时确认 → 该列**归你所有并永久封锁**。
- 封锁后：其他玩家在该列的进度**清零**，任何人（包括你自己）都不能再推进该列。
- 先占领 **5 列**者获胜。

### 列长度与概率

| 数字 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
| ---- | - | - | - | - | - | - | - | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| 概率 | 0.5% | 1.4% | 2.8% | 4.6% | 6.9% | 9.7% | 11.6% | 12.5% | 12.5% | 11.6% | 9.7% | 6.9% | 4.6% | 2.8% | 1.4% | 0.5% |
| 长度 | 3 | 6 | 9 | 12 | 15 | 18 | 21 | 24 | 24 | 21 | 18 | 15 | 12 | 9 | 6 | 3 |

### 一个例子

> 骰子摇出 `3 3 4 4 4 5 5 5 6`，系统给你 5 种分法，你选了 `[10, 14, 13]`。
> 此时你腿上：10 号第 5 格、14 号第 2 格（已用 2 条腿）。
> 落地：10 号 → 6 格，14 号 → 3 格，13 号是新列 → 占第 3 条腿，落 1 格。
> 选择「继续摇」→ 新骰面 `6 6 6 6 6 6 6 6 6`，只给 1 种分法 `[18, 18, 18]`。
> 18 号是新列，但 3 条腿已满 → **落不进** → **BUST**，这一回合的 3 格全部作废。

---

## 二、本地跑起来

需要 **Node.js 18+**。

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # 改代码自动重启
npm test           # 14 项规则测试（含 200 局完整对局模拟）
```

不配数据库也能玩：自动使用本地 SQLite `file:local.db`。

---

## 三、配置 Turso 数据库

### 1) 安装 Turso CLI

| 系统 | 命令 |
| --- | --- |
| Windows | `winget install ChiselStrike.Turso` |
| macOS / Linux | `curl -sSfL https://get.tur.so/install.sh \| bash` |

### 2) 登录并建库

```bash
turso auth login
turso db create ybbn-extra
```

### 3) 拿配置值

```bash
turso db show ybbn-extra --url      # → libsql://ybbn-extra-xxxx.turso.io
turso db tokens create ybbn-extra   # → 一长串令牌
```

### 4) 本地验证（可选）

```powershell
$env:TURSO_DATABASE_URL="libsql://xxxx.turso.io"
$env:TURSO_AUTH_TOKEN="eyJhbGciOi..."
npm run db:init
# ✅ 数据库连接成功（Turso 远程）  表：games, game_players, players, replay_log, results
```

> 建表自动完成，无需手动执行 SQL。

---

## 四、上传到 GitHub

```bash
git init
git add .
git commit -m "feat: 欲罢不能 9骰扩展包"
git branch -M main
git remote add origin https://github.com/<你的用户名>/ybbn-extra.git
git push -u origin main
```

`.gitignore` 已排除 `node_modules/`、`.env`、`*.db`。

---

## 五、部署到 Render

### 方式 A：Blueprint（推荐）

1. 登录 <https://render.com>，GitHub 授权。
2. **New +** → **Blueprint** → 选仓库 → **Connect**。
3. Render 读取 `render.yaml` → **Apply**。
4. 在 **Environment** 填：
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
5. 保存后自动部署，日志出现 `🎲 欲罢不能 · 9骰扩展包` 即成功。

### 方式 B：手动

**New + → Web Service** → 选仓库：

- Runtime `Node`，Build `npm ci`，Start `npm start`
- 环境变量：`NODE_ENV=production`、`COOKIE_SECURE=1`、两个 Turso 变量

### 验证

```
https://<你的域名>/api/health
# {"ok":true,"db":"turso","rules":"欲罢不能 · 9骰扩展包","time":...}
```

`"db":"turso"` 表示数据库已接通。

---

## 六、怎么玩

1. 首页输入昵称 → 「开始」。
2. 「开一桌」选电脑对手数量 → **创建房间**。
3. 拉朋友：把网址和**房间码**发给他，他在「加入房间」填码。

### 对局中

1. 左侧显示 9 枚骰子。
2. 轮到你时，下方列出 **5 种分法**，每种都标明「哪几列前进几格」（绿色=新开列，橙色=已有列推进）。
3. 点一种 → 立即落地，棋盘上闪烁边框就是你的 3 条腿。
4. 然后选 **✋ 停止** 或 **🎲 继续摇**。

### 策略要点

- **重复数字是宝**：`13+8+13` 比 `12+9+9` 更能集中火力，一列直接推 2~3 格。
- **3 条腿很紧**：一回合最多碰 3 列，所以选分法时要考虑「这 3 个数字会不会把腿用光」。
- **腿用满后很危险**：此时新数字落不进来，只能靠已有列，容易爆。
- **抢列**：在对手快占满的列上抢先占满，他那一列的全部进度直接清零。
- **5 列才能赢**：前期可以广撒网，中后期要聚焦在 2~3 列上冲刺。

---

## 七、项目结构

```
ybbn-extra/
├── server.js               # Express 入口
├── shared/
│   ├── engine.js           # 游戏引擎（280 种分法、腿、封锁、胜负）
│   └── ai.js               # 电脑 AI + 胜率预估
├── src/
│   ├── db.js               # Turso / libSQL 数据层
│   └── rooms.js            # 房间与对局管理
├── public/
│   ├── index.html · style.css · app.js
├── tests/engine.test.js    # 14 项规则测试
├── scripts/
│   ├── setup-turso.sh · init-db.mjs
├── render.yaml
└── .env.example
```

### 数据表

| 表 | 用途 |
| --- | --- |
| `players` | 玩家（Cookie 令牌，免注册） |
| `games` | 对局，`state_json` 存完整局面 |
| `game_players` | 座位映射 |
| `results` | 战绩（排行榜数据源） |
| `replay_log` | 动作日志 |

---

## 八、API 速查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/meta` | 规则常量 |
| POST | `/api/login` | `{name}` |
| GET | `/api/me` | 当前玩家与战绩 |
| GET | `/api/rooms` | 房间列表 |
| POST | `/api/rooms` | `{roomName, botCount}` 建房 |
| POST | `/api/rooms/join` | `{code}` 加入 |
| GET | `/api/rooms/:id` | 拉取对局（含本回合 5 种分法） |
| POST | `/api/games/:id/act` | `{action:"choose", key}` / `{action:"continue"}` / `{action:"stop"}` |
| GET | `/api/games/:id/simulate` | 胜率预估 |
| GET | `/api/leaderboard` | 排行榜 |

---

## 九、常见问题

**Q：为什么每回合只有 5 种分法？**
280 种全开放会让玩家总能凑出"同一列连走 3 格"的组合，实测游戏 12 回合就结束、先手胜率 65%。限制为抽 5 种后：回合数中位 48、先手胜率 56:44，每次选择都是真实取舍。

**Q：为什么 5 个选项里有些是灰的？**
因为是从 280 种里**随机抽**的，不做预先过滤。抽到"腿已满无法进入新列"或"数字落在封锁列"的分法时，它就走不了，会被禁用。实测约 6% 的选项是这种。

**Q：为什么爆率只有 0.2%？**
9 枚骰子自由分组的组合自由度极高。腿在中段列（5~15 号）时，一次摇骰仍有约 99% 概率能落到有效列。爆掉主要发生在：腿全落在极端列（3/4/5 或 16/17/18，爆率约 37%），或腿所在列已走到顶。这是「9 骰 + 3 腿」参数的数学属性，不是实现问题。

**Q：Render 免费实例会休眠？**
15 分钟无流量休眠，唤醒约 30~50 秒。**对局状态存在 Turso，不会丢**。

**Q：`缺少 TURSO_DATABASE_URL`？**
Environment 没填或没重新部署。改完点 **Manual Deploy → Deploy latest commit**。

**Q：能改规则参数吗？**
- 路径长度：`shared/engine.js` 的 `PATH_LENGTHS`
- 路标数：`RULES.markers`
- 获胜列数：`RULES.winColumns`
- 每回合分法数：`OFFER_COUNT`

改完 `npm test` 验证。

---

## 十、许可

MIT。玩法属于 Sid Sackson 设计的 Can't Stop；本仓库的扩展参数与实现为原创。
参考 [UltraBoardGames 官方规则](https://www.ultraboardgames.com/cant-stop/game-rules.php) 与 [BGA 规则说明](https://en.doc.boardgamearena.com/wiki/Gamehelpcantstop)。

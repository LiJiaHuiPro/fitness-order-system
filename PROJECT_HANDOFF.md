# 体测接单管理系统 - 全量交接文档（给下一个 AI 直接上手）

> 目的：把这个项目的业务、代码、部署、历史变更、当前状态、风险、后续建议一次性讲清楚。  
> 使用方法：把本文件直接发给下一个 AI，让它“先读此文件再改代码”。

---

## A. 项目一句话说明
这是一个面向小规模校内场景的 **体测接单管理系统**：学生下单、接单人抢单/完成、管理员全局管控（看板/指派/删除/清空），替代手工备忘录防漏单。

---

## B. 当前技术栈与运行方式

### B1. 技术栈
- 后端：Node.js + Express
- 数据库：SQLite（better-sqlite3）
- 前端：单文件静态页（`demo.html`，原生 JS）
- 鉴权：内存 token（`Map`，非 JWT 持久化）

### B2. 关键文件
- `server.js`：后端全部逻辑与数据库初始化
- `demo.html`：前端 UI + 交互 + API 调用
- `data.db`：本地 SQLite 文件
- `package.json`：依赖与启动脚本
- `railpack.toml`：Railway 构建配置

### B3. 本地启动
```bash
npm install
npm start
```
默认端口 `3000`（可由 `PORT` 环境变量覆盖）。

---

## C. 业务角色与完整流程

## C1. 学生（公开页）
1. 填写：姓名、学号、性别（按钮）、项目（按钮可多选）、要求（可空）、微信名（必填）
2. 提交后，后端会把多项目拆成多条订单（每个项目一条）
3. 同一次提交拆出来的每条订单，**微信名与要求一致**

## C2. 接单人
1. 注册接单账号（姓名规则校验）
2. 登录后看抢单大厅（只看 `pending`）
3. 可执行：
   - 接单：`pending -> in_progress`
   - 标记完成：`in_progress -> completed`
   - 撤销回大厅（防误触）：
     - `in_progress -> pending`
     - `completed -> pending`
4. 接单记录显示自己的历史订单

## C3. 管理员
1. 登录后看到全局数据卡片
2. 可查看：
   - 总订单 / 待抢 / 进行中 / 已完成 / 完成率
   - 按项目分类统计（标准项目）
   - 接单人概览（进行中数、完成数）
3. 可执行：
   - 指派待接订单给某接单人
   - 删除单条订单
   - 清空全部订单

---

## D. 数据模型（SQLite）

## D1. users
- `id` INTEGER PK
- `username` TEXT UNIQUE
- `password_hash` TEXT
- `role` CHECK in `worker/admin`
- `created_at` INTEGER(ms)

## D2. orders
- `id` INTEGER PK
- `client_name` TEXT
- `student_no` TEXT
- `project` TEXT
- `amount` REAL（历史遗留，前端已不再使用）
- `requirement` TEXT
- `remark` TEXT（当前语义是微信名）
- `gender` TEXT（后加字段，启动时自动补列）
- `status` CHECK in `pending/in_progress/completed/cancelled`
- `worker_id` INTEGER nullable
- `worker_username` TEXT nullable
- `created_at` INTEGER(ms)
- `accepted_at` INTEGER nullable
- `completed_at` INTEGER nullable

## D3. 索引与约束
- `idx_orders_status`
- `idx_orders_worker`
- 去重索引：`idx_orders_dedup`  
  约束含义：同一学号 + 同一项目 + 同一天不能重复下单。

---

## E. 项目分类（标准化规则）

当前允许的标准项目（固定）：
1. 50米
2. 800米
3. 1000米
4. 立定跳远
5. 坐位体前屈
6. 肺活量
7. 仰卧起坐
8. 引体向上

不包含：身高体重。

前后端都实现了 `normalizeProject(raw)`，会将类似：
- `50m`、`50 米` -> `50米`
- 包含“跳远”的文本 -> `立定跳远`
- 包含多个混合词的脏文案 -> 尽量归一到标准项目

后端启动时会遍历历史订单并尝试把 `orders.project` 清洗为标准项目（仅能识别的才改）。

---

## F. 已实现 API 清单（可直接用于联调）

## F1. 鉴权
- `POST /api/auth/register-worker`
  - body: `{ username, password }`
  - 规则：用户名2-20、不能带数字、仅中英文/空格/·；密码>=6
- `POST /api/auth/login`
  - body: `{ username, password }`
  - return: `{ token, user }`

## F2. 订单（学生/接单人）
- `POST /api/orders`
  - body:
    - 单项目兼容：`project`
    - 多项目主路径：`projects: string[]`
    - 其他：`name, studentNo, gender, requirement, remark`
  - 必填：`name/studentNo/gender/projects(>=1)/remark`
  - 行为：多项目拆单事务写入
- `GET /api/orders/hall`（worker）
- `GET /api/orders/mine`（worker）
- `POST /api/orders/:id/accept`（worker）
- `POST /api/orders/:id/complete`（worker）
- `POST /api/orders/:id/revert`（worker）
  - 允许状态：`in_progress/completed`
  - 回滚到 `pending` 并清空 worker 与时间戳

## F3. 管理员
- `GET /api/admin/stats`
- `GET /api/admin/orders`
- `GET /api/admin/workers`
- `POST /api/admin/orders/:id/assign`
- `DELETE /api/admin/orders/:id`
- `DELETE /api/admin/orders`

---

## G. 前端页面结构与交互要点（demo.html）

## G1. 视图区块
- `#publicView`：公开入口（学生下单 + 接单后台登录/注册）
- `#appView`：登录后区域
  - `#workerPanel`
  - `#adminPanel`

## G2. 会话机制
- localStorage key: `tm_server_session`
- 存储：`{ token, user }`
- API 请求自动加 `Authorization: Bearer ...`

## G3. 学生下单 UI（当前）
- 性别：按钮（男/女），写入隐藏域 `#cGender`
- 项目：多选按钮，写入隐藏域 `#cProject`（JSON 数组字符串）
- 微信名输入：`#cRemark`（必填）
- 提交时 payload 发送 `projects` 数组

## G4. 接单人 UI
- 抢单大厅按项目分组展示（按创建时间早到晚排序）
- 接单记录：
  - 进行中：显示“标记完成”+“撤销回大厅”
  - 已完成：显示“撤销回大厅”

## G5. 管理员 UI
- 数据统计卡片 + 项目统计列表
- 接单人概览 chips
- 待接订单：按钮式选择接单人 + 指派
- 已接/全部订单：可删除
- 清空订单按钮带确认弹窗

---

## H. 管理员账号与安全现状
- 当前硬编码在 `server.js`：
  - `ADMIN_NAME = "刘泽璇"`
  - `ADMIN_PASSWORD = "18929649836"`
- `ensureAdmin()` 在服务启动时执行：
  - 若无 admin 则创建
  - 若已存在则强制更新用户名与密码

影响：每次重启会覆盖 admin 凭据到代码常量值。

---

## I. 部署与运维（Railway）

## I1. 当前部署状态（已确认）
- 服务已重新连接 GitHub 仓库与 main 分支（Repo not found 已修复）
- SQLite Volume 已挂载
  - Volume: `sqlite-data`
  - Mount Path: `/app/data`
- 环境变量
  - `DB_PATH=/app/data/data.db`

这表示数据库文件已持久化，不会因普通重启丢失。

## I2. 更新发布流程
1. 本地改代码
2. `git add/commit/push`
3. Railway 自动拉取并部署
4. 前端强刷（Cmd+Shift+R）验证

---

## J. 需求迭代历史（按对话整合）
1. 初始诉求：做一个简单体测接单系统，公网可访问  
2. 明确三角色：学生、接单人、管理员  
3. UI 多轮美化（卡片、渐变、移动端优化）  
4. 文案调整：客户->学生、去掉免注册提示  
5. 管理员账号不在页面显式展示，账号固定为刘泽璇  
6. 去金额输入（后端保留列）  
7. 备注提示改为微信协商  
8. 管理员增强：接单人概览、指派、删除、清空  
9. 订单显示下单时间并按“紧急=更早”排序  
10. 项目分类化：下单选择、大厅分组、管理统计分组  
11. 新增项目：引体向上、1000米  
12. 性别改为按钮选择，微信名改必填  
13. 项目支持多选并拆单，备注保持一致  
14. 接单人可撤销接单/撤销完成并回大厅  
15. Railway 排查：Repo not found 修复、Volume 与 DB_PATH 对齐确认

---

## K. 当前已知风险与技术债
1. **管理员密码硬编码**（高优先）  
2. token 在内存中，服务重启后会失效（用户需重登）  
3. `GET /api/admin/stats` 仍返回 `ranks`，但前端已不显示接单排行（轻度冗余）  
4. `amount` 字段历史遗留，前端不再使用（可后续迁移清理）  
5. `demo.html` 体量持续增长，可维护性下降（建议拆分）

---

## L. 推荐下一步（如果继续开发）
1. 把管理员账号密码改成环境变量（并移除硬编码）  
2. 给关键操作加操作日志（指派、撤销、删除、清空）  
3. 增加“订单详情弹层”减少卡片堆叠  
4. 若人数增长，迁移 PostgreSQL  
5. 增加基础自动化测试（至少 API 主流程）

---

## M. 常用命令速查
```bash
# 本地
cd "/Users/liurunkai/Desktop/体测接单管理系统"
npm install
npm start

# 提交
git add .
git commit -m "feat: xxx"
git push
```

---

## N. 给下一个 AI 的直接提示词（复制即用）
> 请先完整阅读项目根目录 `PROJECT_HANDOFF.md`。  
> 这是一个 Node.js + Express + SQLite 的体测接单系统，前端集中在 `demo.html`，后端在 `server.js`。  
> 请在不重构的前提下做最小改动，保持现有业务逻辑与 UI 风格；改完请给出可直接执行的 `git add/commit/push` 命令。  
> 重点注意：项目分类标准化、项目多选拆单、接单人撤销回大厅、管理员指派与删除能力、Railway 的 `DB_PATH=/app/data/data.db` 持久化约束。


const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const app = express();
const dbPath = process.env.DB_PATH || path.join(__dirname, "data.db");
const db = new Database(dbPath);
const PORT = process.env.PORT || 3000;
const ADMIN_NAME = "18929649836";
const ADMIN_PASSWORD = "18929649836";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('worker','admin')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  project TEXT NOT NULL,
  amount REAL NOT NULL,
  requirement TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  worker_id INTEGER,
  worker_username TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_worker ON orders(worker_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_dedup
ON orders(student_no, project, strftime('%Y-%m-%d', created_at / 1000, 'unixepoch'));
`);

function ensureAdmin() {
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  if (!admin) {
    db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES(?,?,?,?)")
      .run(ADMIN_NAME, hash, "admin", Date.now());
    return;
  }
  db.prepare("UPDATE users SET username=?, password_hash=? WHERE id=?").run(ADMIN_NAME, hash, admin.id);
}
ensureAdmin();

app.use(express.json());
app.use(express.static(__dirname));

const tokens = new Map();
function issueToken(user) {
  const token = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tokens.set(token, { id: user.id, username: user.username, role: user.role });
  return token;
}
function getAuth(req) {
  const token = req.headers.authorization?.replace("Bearer ", "").trim();
  if (!token || !tokens.has(token)) return null;
  return tokens.get(token);
}
function requireAuth(req, res, roles) {
  const auth = getAuth(req);
  if (!auth) return res.status(401).json({ message: "未登录" });
  if (roles && !roles.includes(auth.role)) return res.status(403).json({ message: "无权限" });
  req.auth = auth;
  return null;
}

app.post("/api/auth/register-worker", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  if (!username || !password) return res.status(400).json({ message: "账号和密码不能为空" });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ message: "真实姓名长度需在2-20字" });
  if (/\d/.test(username)) return res.status(400).json({ message: "接单人账号请填写真实姓名，不要带数字" });
  if (!/^[\u4e00-\u9fa5A-Za-z·\s]+$/.test(username)) return res.status(400).json({ message: "账号仅支持中文或英文姓名" });
  if (password.length < 6) return res.status(400).json({ message: "密码至少6位" });
  const exists = db.prepare("SELECT id FROM users WHERE username=?").get(username);
  if (exists) return res.status(400).json({ message: "账号已存在" });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)")
    .run(username, hash, "worker", Date.now());
  res.json({ message: "注册成功，请登录" });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const user = db.prepare("SELECT id, username, password_hash, role FROM users WHERE username=?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ message: "账号或密码错误" });
  }
  const token = issueToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post("/api/orders", (req, res) => {
  const clientName = String(req.body.name || "").trim();
  const studentNo = String(req.body.studentNo || "").trim();
  const project = String(req.body.project || "").trim();
  const amount = Number(req.body.amount);
  const requirement = String(req.body.requirement || "").trim();
  const remark = String(req.body.remark || "").trim();
  if (!clientName || !studentNo || !project || Number.isNaN(amount)) {
    return res.status(400).json({ message: "姓名/学号/项目/金额必填" });
  }
  try {
    db.prepare(`
      INSERT INTO orders(client_name, student_no, project, amount, requirement, remark, status, created_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(clientName, studentNo, project, amount, requirement, remark, "pending", Date.now());
    res.json({ message: "下单成功" });
  } catch (e) {
    if (String(e.message).includes("idx_orders_dedup")) {
      return res.status(400).json({ message: "同一学号同一项目今天已下单" });
    }
    return res.status(500).json({ message: "下单失败" });
  }
});

app.get("/api/orders/hall", (req, res) => {
  const denied = requireAuth(req, res, ["worker"]);
  if (denied) return;
  const rows = db.prepare("SELECT * FROM orders WHERE status='pending' ORDER BY created_at DESC").all();
  res.json(rows);
});

app.get("/api/orders/mine", (req, res) => {
  const denied = requireAuth(req, res, ["worker"]);
  if (denied) return;
  const rows = db.prepare("SELECT * FROM orders WHERE worker_id=? ORDER BY created_at DESC").all(req.auth.id);
  res.json(rows);
});

app.post("/api/orders/:id/accept", (req, res) => {
  const denied = requireAuth(req, res, ["worker"]);
  if (denied) return;
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id, status FROM orders WHERE id=?").get(id);
  if (!row || row.status !== "pending") return res.status(400).json({ message: "订单不可接" });
  db.prepare(`
    UPDATE orders
    SET status='in_progress', worker_id=?, worker_username=?, accepted_at=?
    WHERE id=?
  `).run(req.auth.id, req.auth.username, Date.now(), id);
  res.json({ message: "接单成功" });
});

app.post("/api/orders/:id/complete", (req, res) => {
  const denied = requireAuth(req, res, ["worker"]);
  if (denied) return;
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id, status, worker_id FROM orders WHERE id=?").get(id);
  if (!row || row.status !== "in_progress" || row.worker_id !== req.auth.id) {
    return res.status(400).json({ message: "订单不可完成" });
  }
  db.prepare("UPDATE orders SET status='completed', completed_at=? WHERE id=?").run(Date.now(), id);
  res.json({ message: "已完成" });
});

app.get("/api/admin/orders", (req, res) => {
  const denied = requireAuth(req, res, ["admin"]);
  if (denied) return;
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  res.json(rows);
});

app.get("/api/admin/stats", (req, res) => {
  const denied = requireAuth(req, res, ["admin"]);
  if (denied) return;
  const total = db.prepare("SELECT COUNT(*) c FROM orders").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c;
  const inProgress = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='in_progress'").get().c;
  const completed = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='completed'").get().c;
  const ranks = db.prepare(`
    SELECT worker_username, COUNT(*) cnt
    FROM orders
    WHERE worker_username IS NOT NULL
    GROUP BY worker_username
    ORDER BY cnt DESC
    LIMIT 5
  `).all();
  res.json({ total, pending, inProgress, completed, ranks });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

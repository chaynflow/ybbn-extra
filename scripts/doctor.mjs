/**
 * Turso 连接诊断：逐项检查环境变量，并尝试真实连接。
 *
 * 用法：
 *   npm run db:doctor
 *   或： node scripts/doctor.mjs
 *
 * 它会告诉你问题出在「缺变量 / 格式错 / token 与数据库不匹配」哪一环。
 */
import { createClient } from '@libsql/client';

const env = process.env;
const out = [];
const log = (...a) => out.push(a.join(' '));

let problems = 0;
const bad = (msg) => {
  problems++;
  log(`❌ ${msg}`);
};
const ok = (msg) => log(`✅ ${msg}`);
const warn = (msg) => log(`⚠️  ${msg}`);

const url = (env.TURSO_DATABASE_URL || '').trim();
const token = (env.TURSO_AUTH_TOKEN || '').trim();

log('════════ Turso 连接诊断 ════════\n');

/* 1. 变量是否存在 */
if (!url) {
  bad('缺少 TURSO_DATABASE_URL');
} else if (!token) {
  bad('缺少 TURSO_AUTH_TOKEN');
} else {
  ok('两个环境变量都存在');
}

if (problems) {
  log('\n在 Render 里：Environment → 添加这两个变量 → Manual Deploy → Deploy latest commit');
  log('本地测试：先 export/set 这两个变量再运行本脚本');
  console.log(out.join('\n'));
  process.exit(1);
}

/* 2. URL 格式 */
if (url !== env.TURSO_DATABASE_URL) warn('TURSO_DATABASE_URL 首尾有空白，已自动去掉');
if (url.startsWith('"') || url.startsWith("'")) bad('TURSO_DATABASE_URL 带了引号，请去掉引号只填地址本身');

if (url.startsWith('libsql://') || url.startsWith('https://')) {
  ok(`URL 协议正确：${url.split('://')[0]}://`);
} else if (url.startsWith('http://')) {
  warn('URL 是 http://（明文），Turso 一般用https');
} else if (url.startsWith('file:')) {
  warn('URL 是本地文件，不是 Turso 远程库');
} else {
  bad(`URL 协议不认识：${url.split('://')[0] || '(无协议)'}，应为 libsql:// 或 https://`);
}

// 主机名形态
try {
  const host = new URL(url.replace(/^libsql:\/\//, 'https://')).hostname;
  if (host.endsWith('.turso.io')) ok(`主机名正确：${host}`);
  else warn(`主机名不是 *.turso.io：${host}（本地或自建 libSQL 可忽略）`);
} catch {
  bad(`URL 无法解析：${url}`);
}

/* 3. token 格式（JWT 有三段） */
if (token !== env.TURSO_AUTH_TOKEN) warn('TURSO_AUTH_TOKEN 首尾有空白，已自动去掉');
if (token.startsWith('"') || token.startsWith("'")) bad('TURSO_AUTH_TOKEN 带了引号，请去掉');

const parts = token.split('.');
if (parts.length === 3) {
  ok(`token 是标准 JWT（3 段，长度 ${token.length}）`);
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp) {
      const exp = new Date(payload.exp * 1000);
      if (exp.getTime() < Date.now()) {
        bad(`token 已过期（${exp.toISOString()}），请重新生成`);
      } else {
        ok(`token 有效期至 ${exp.toISOString()}`);
      }
    }
    if (payload.iat) ok(`token 创建于 ${new Date(payload.iat * 1000).toISOString()}`);
    // Turso 的 token 里通常带数据库标识
    const j = JSON.stringify(payload);
    const m = j.match(/[a-z0-9-]+\.turso\.io/);
    if (m) ok(`token 所属数据库：${m[0]}`);
  } catch {
    warn('token payload 无法解析（可能被截断）');
  }
} else {
  bad(`token 不是标准 JWT（有 ${parts.length} 段，应为 3 段）——很可能复制不完整`);
}

/* 4. 真实连接 */
if (problems === 0) {
  log('\n── 尝试真实连接 ──');
  const client = createClient({
    url: url.startsWith('libsql://') ? url.replace('libsql://', 'https://') : url,
    authToken: token,
  });
  try {
    const r = await client.execute('SELECT COUNT(*) AS c FROM sqlite_master');
    ok(`连接成功，读表数 ${r.rows[0].c}`);
  } catch (e) {
    const code = e.code || '';
    const status = e.cause?.status;
    if (status === 401) {
      bad('HTTP 401：token 无效 / 不属于该数据库 / 已被删除');
      log('   → 到 https://app.turso.tech 打开该数据库 → Tokens → Create Token');
    } else if (status === 404) {
      bad('HTTP 404：数据库地址不存在（URL 里的库名可能写错）');
      log('   → 用 turso db list 或网页后台核对 URL');
    } else if (status === 403) {
      bad('HTTP 403：token 权限不足（可能是只读 token 却执行了写操作）');
    } else {
      bad(`连接失败：${code} ${e.message}`);
    }
  }
}

log('\n════════ 结果 ════════');
log(problems === 0 ? '全部正常 ✅' : `发现 ${problems} 个问题 ❌`);
console.log(out.join('\n'));
process.exit(problems === 0 ? 0 : 1);

/**
 * 手动初始化数据库（一般不需要：服务启动时会自动建表）。
 * 用途：验证 Turso 连接是否配置正确。
 *
 *   npm run db:init            # 使用 .env / 环境变量里的 Turso
 *   DB_MODE=local npm run db:init
 */
import { initDb, db, isRemote, qAll } from '../src/db.js';

try {
  await initDb();
  const tables = await qAll(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  console.log(`✅ 数据库连接成功（${isRemote ? 'Turso 远程' : '本地文件'}）`);
  console.log('   表：', tables.map((t) => t.name).join(', '));
  const g = await qAll('SELECT COUNT(*) AS c FROM games');
  const p = await qAll('SELECT COUNT(*) AS c FROM players');
  console.log(`   已有：玩家 ${p[0].c} 条，对局 ${g[0].c} 条`);
  process.exit(0);
} catch (e) {
  console.error('❌ 连接失败：', e.message);
  console.error('\n请检查：');
  console.error('  - TURSO_DATABASE_URL 形如 libsql://xxx.turso.io');
  console.error('  - TURSO_AUTH_TOKEN 是否有效（turso db tokens create <db>）');
  process.exit(1);
}

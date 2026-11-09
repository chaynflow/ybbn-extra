# 从 zero 到上线：Turso 建库脚本（Windows PowerShell / macOS / Linux 均可）
#
# 前提：已安装 Turso CLI
#   Windows (winget):  winget install ChiselStrike.Turso
#   或 curl:           curl -sSfL https://get.tur.so/install.sh | bash
#
# 运行：  bash scripts/setup-turso.sh
# 结束后把输出里的两行复制到 Render 的 Environment 里。

set -e

DB_NAME="${DB_NAME:-ybbn-extra}"

echo "▶ 1/3 登录 Turso（第一次会打开浏览器或给出验证链接）"
turso auth login

echo
echo "▶ 2/3 创建数据库 ${DB_NAME}（组：优先离中国近的 aws ap-northeast-1）"
if turso db show "$DB_NAME" >/dev/null 2>&1; then
  echo "   数据库已存在，跳过创建"
else
  turso db create "$DB_NAME" --group ybbn-extra --location aws-ap-northeast-1 2>/dev/null \
    || turso db create "$DB_NAME"
fi

echo
echo "▶ 3/3 生成访问令牌并打印连接信息"
URL="$(turso db show "$DB_NAME" --url)"
TOKEN="$(turso db tokens create "$DB_NAME")"

echo
echo "================ 复制下面两行到 Render Environment ================"
echo "TURSO_DATABASE_URL=$URL"
echo "TURSO_AUTH_TOKEN=$TOKEN"
echo "=================================================================="
echo
echo "建表不用手动做：应用启动时会自动执行 CREATE TABLE IF NOT EXISTS。"
echo "想先在本地核实，可以执行："
echo "  TURSO_DATABASE_URL=\"$URL\" TURSO_AUTH_TOKEN=\"$TOKEN\" node scripts/init-db.js"

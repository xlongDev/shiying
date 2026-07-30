#!/bin/bash
# 自动检测并关闭占用指定端口的开发服务器

# ====== 配置区 ======
# 默认要检查的端口列表（可自行增删）
DEFAULT_PORTS=(3000 3001)
# ===================

# 如果运行脚本时传入了端口参数，则使用参数；否则使用默认列表
if [ $# -eq 0 ]; then
    PORTS=("${DEFAULT_PORTS[@]}")
else
    PORTS=("$@")
fi

echo "🔍 将检查并关闭以下端口上的服务: ${PORTS[*]}"
echo "----------------------------------------"

for PORT in "${PORTS[@]}"; do
    # 只查找处于 LISTEN 状态的进程（更精确）
    PIDS=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null)
    
    if [ -z "$PIDS" ]; then
        echo "✅ 端口 $PORT 上没有监听的进程。"
    else
        echo "⚠️  端口 $PORT 上找到进程 PID: $PIDS"
        for PID in $PIDS; do
            echo "  正在终止 PID $PID ..."
            kill -9 $PID 2>/dev/null
            if [ $? -eq 0 ]; then
                echo "  ✅ 成功终止 PID $PID"
            else
                echo "  ❌ 终止 PID $PID 失败（可能需要 sudo 权限）"
            fi
        done
    fi
done

echo "----------------------------------------"
echo "🎯 操作完成。"
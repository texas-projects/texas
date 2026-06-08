#!/bin/bash
input=$(cat)

# 提取 file_path
file_path=$(echo "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# 无路径则放行
[ -z "$file_path" ] && exit 0

# 非 .md 文件放行
case "$file_path" in
  *.md) ;;
  *) exit 0 ;;
esac

# 路径含 /misc/ 或 \misc\ 则放行
case "$file_path" in
  */misc/*|*\\misc\\*) exit 0 ;;
esac

# 拒绝
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"禁止在 misc 目录以外写入 .md 文件"}}\n'
exit 1
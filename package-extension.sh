#!/bin/bash
# package-extension.sh — 自动打包生成干净的 Chrome 商店提包 ZIP

EXTENSION_NAME="ContextLens"
VERSION=$(node -p "require('./manifest.json').version")
OUTPUT="${EXTENSION_NAME}-v${VERSION}.zip"

# 清理可能存在的旧包
rm -f "$OUTPUT"

echo "📦 开始为 ContextLens (v$VERSION) 打包..."

# 创建 ZIP 压缩包，严格排除开发文件、文档及隐藏文件
zip -r "$OUTPUT" . \
  -x ".git/*" \
  -x ".git" \
  -x "node_modules/*" \
  -x "node_modules" \
  -x "*.zip" \
  -x "package-extension.sh" \
  -x "CHROMEWEBSTORE.md" \
  -x "README.md" \
  -x "generate_icons.py" \
  -x "implementation_plan.md" \
  -x "implementation_plan_zh.md" \
  -x ".DS_Store" \
  -x "*/.DS_Store" \
  -x "Thumbs.db"

if [ $? -eq 0 ]; then
  echo "✅ 打包成功！"
  echo "🎉 最终生成的商店提交包为: $OUTPUT"
  echo "📊 文件大小: $(du -h "$OUTPUT" | cut -f1)"
  echo "💡 提示：在提交至 Chrome 开发者后台时，直接上传此 ZIP 文件即可。"
else
  echo "❌ 打包失败，请检查是否安装了 zip 工具。"
fi

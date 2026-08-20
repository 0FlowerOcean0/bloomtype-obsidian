# 参与贡献

感谢你帮助改进 Bloomtype Obsidian 插件。

## 开始开发

1. Fork 并克隆仓库。
2. 运行 `npm install`。
3. 运行 `npm run dev` 监听源码变化，或运行 `npm run build` 生成生产构建。
4. 将 `main.js`、`manifest.json`、`styles.css` 复制到测试 Vault 的 `.obsidian/plugins/bloomtype-publisher/`。
5. 在 Obsidian 中重新加载插件并完成真实分栏测试。

## 提交前检查

- `npm run build` 必须通过。
- 不要提交 Vault、笔记、`data.json`、访问令牌或其他私人配置。
- 涉及消息桥接时，必须保留来源校验、消息版本校验和 5 MB 文稿上限。
- 界面变化至少验证窄侧栏和普通双栏两种宽度。

## 问题与合并请求

请说明复现步骤、Obsidian 版本、操作系统和预期行为。若问题涉及私人笔记，只提供最小化的脱敏示例。

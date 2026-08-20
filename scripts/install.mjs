import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const pluginId = "bloomtype-publisher"
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const vaultPath = process.argv[2] ? resolve(process.argv[2]) : ""

if (!vaultPath) {
  throw new Error("请传入 Obsidian 仓库路径，例如：npm run install:vault -- /path/to/vault")
}

const obsidianDir = join(vaultPath, ".obsidian")
const targetDir = join(obsidianDir, "plugins", pluginId)
const enabledPluginsFile = join(obsidianDir, "community-plugins.json")

await readFile(join(obsidianDir, "app.json"), "utf8")
await Promise.all([
  readFile(join(pluginRoot, "main.js")),
  readFile(join(pluginRoot, "manifest.json"), "utf8"),
  readFile(join(pluginRoot, "styles.css"), "utf8"),
])

await mkdir(targetDir, { recursive: true })
await Promise.all(
  ["main.js", "manifest.json", "styles.css"].map((file) =>
    copyFile(join(pluginRoot, file), join(targetDir, file)),
  ),
)

let plugins = []
try {
  const source = await readFile(enabledPluginsFile, "utf8")
  const parsed = JSON.parse(source)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("community-plugins.json 结构不是字符串数组")
  }
  plugins = parsed
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
}

const wasEnabled = plugins.includes(pluginId)
if (!wasEnabled) {
  const next = [...plugins, pluginId]
  const tempFile = `${enabledPluginsFile}.bloomtype.tmp`
  if (plugins.length > 0) {
    await copyFile(enabledPluginsFile, `${enabledPluginsFile}.bloomtype.bak`)
  }
  await writeFile(tempFile, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  await rename(tempFile, enabledPluginsFile)
}

process.stdout.write(
  `${JSON.stringify(
    {
      pluginId,
      vaultPath,
      targetDir,
      enabled: true,
      alreadyEnabled: wasEnabled,
      backup: plugins.length > 0 ? `${enabledPluginsFile}.bloomtype.bak` : null,
    },
    null,
    2,
  )}\n`,
)

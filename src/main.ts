import {
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  TFile,
  WorkspaceLeaf,
} from "obsidian"

const VIEW_TYPE_BLOOMTYPE = "bloomtype-publisher-view"
const DEFAULT_SERVICE_URL = "https://mp.autoaihub.cn"
const MESSAGE_VERSION = 1
const MAX_NOTE_BYTES = 5 * 1024 * 1024

const MESSAGE = {
  ready: "BLOOMTYPE_OBSIDIAN_READY",
  load: "BLOOMTYPE_OBSIDIAN_LOAD",
  loaded: "BLOOMTYPE_OBSIDIAN_LOADED",
} as const

interface BloomtypeSettings {
  serviceUrl: string
  autoSync: boolean
}

interface BridgeReadyMessage {
  type: typeof MESSAGE.ready
  version: number
}

interface BridgeLoadedMessage {
  type: typeof MESSAGE.loaded
  version: number
  filePath?: string
}

const DEFAULT_SETTINGS: BloomtypeSettings = {
  serviceUrl: DEFAULT_SERVICE_URL,
  autoSync: true,
}

type BloomtypeSettingKey = keyof BloomtypeSettings

function isBridgeReadyMessage(value: unknown): value is BridgeReadyMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return message.type === MESSAGE.ready && message.version === MESSAGE_VERSION
}

function isBridgeLoadedMessage(value: unknown): value is BridgeLoadedMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return (
    message.type === MESSAGE.loaded &&
    message.version === MESSAGE_VERSION &&
    (message.filePath === undefined || typeof message.filePath === "string")
  )
}

function toServiceUrl(raw: string, embedded: boolean): URL {
  const value = raw.trim()
  if (!value) throw new Error("服务地址不能为空")

  const url = new URL(value.includes("://") ? value : `https://${value}`)
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("远程服务必须使用 HTTPS；本机调试可使用 localhost HTTP")
  }
  if (embedded) url.searchParams.set("obsidian", "1")
  return url
}

function validateServiceUrl(raw: string): string | void {
  try {
    toServiceUrl(raw, false)
  } catch (error) {
    return error instanceof Error ? error.message : "服务地址无效"
  }
}

function parseSettings(value: unknown): BloomtypeSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS }

  const stored = value as Record<string, unknown>
  return {
    serviceUrl:
      typeof stored.serviceUrl === "string"
        ? stored.serviceUrl.trim()
        : DEFAULT_SETTINGS.serviceUrl,
    autoSync:
      typeof stored.autoSync === "boolean" ? stored.autoSync : DEFAULT_SETTINGS.autoSync,
  }
}

class BloomtypeView extends ItemView {
  private iframe: HTMLIFrameElement | null = null
  private statusEl: HTMLElement | null = null
  private ready = false
  private pendingSync = true
  private lastSignature = ""

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: BloomtypePlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW_TYPE_BLOOMTYPE
  }

  getDisplayText(): string {
    return "Bloomtype 排版"
  }

  getIcon(): string {
    return "palette"
  }

  async onOpen(): Promise<void> {
    this.render()
    this.registerDomEvent(window, "message", (event) => {
      void this.handleMessage(event)
    })
  }

  async onClose(): Promise<void> {
    this.iframe = null
    this.statusEl = null
    this.ready = false
  }

  reloadService(): void {
    this.ready = false
    this.pendingSync = true
    this.lastSignature = ""
    this.render()
  }

  async syncActiveNote(force = false): Promise<void> {
    const file = this.plugin.getCurrentMarkdownFile()
    if (!file) {
      this.setStatus("请先打开一篇 Markdown 笔记", "idle")
      return
    }

    if (!this.ready || !this.iframe?.contentWindow) {
      this.pendingSync = true
      this.setStatus(`等待连接：${file.basename}`, "loading")
      return
    }

    try {
      const markdown = await this.app.vault.cachedRead(file)
      if (new Blob([markdown]).size > MAX_NOTE_BYTES) {
        this.setStatus("笔记超过 5 MB，未自动同步", "error")
        return
      }

      const signature = `${file.path}:${file.stat.mtime}:${markdown.length}`
      if (!force && signature === this.lastSignature) return

      const target = toServiceUrl(this.plugin.settings.serviceUrl, true)
      this.setStatus(`正在同步：${file.basename}`, "loading")
      this.iframe.contentWindow.postMessage(
        {
          type: MESSAGE.load,
          version: MESSAGE_VERSION,
          markdown,
          fileName: file.basename,
          filePath: file.path,
          modifiedAt: file.stat.mtime,
        },
        target.origin,
      )
      this.lastSignature = signature
      this.pendingSync = false
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "同步失败，请重试", "error")
    }
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.addClass("bloomtype-view")
    this.statusEl = root.createDiv({
      cls: "bloomtype-connection-status",
      text: "正在连接 Bloomtype…",
    })
    this.statusEl.dataset.visible = "true"

    try {
      const serviceUrl = toServiceUrl(this.plugin.settings.serviceUrl, true)
      const iframe = root.createEl("iframe", {
        cls: "bloomtype-frame",
        attr: {
          src: serviceUrl.toString(),
          title: "Bloomtype 公众号排版工作台",
          allow: "clipboard-read; clipboard-write",
          referrerpolicy: "strict-origin-when-cross-origin",
        },
      })
      this.iframe = iframe
      iframe.addEventListener("load", () => {
        if (!this.ready) this.setStatus("等待 Bloomtype 响应…", "loading")
      })
      iframe.addEventListener("error", () => {
        this.setStatus("工作台加载失败，请检查服务地址", "error")
      })
    } catch (error) {
      this.iframe = null
      this.setStatus(error instanceof Error ? error.message : "服务地址无效", "error")
      const errorBox = root.createDiv({ cls: "bloomtype-error" })
      errorBox.createEl("strong", { text: "无法打开 Bloomtype" })
      errorBox.createEl("p", { text: "请在插件设置中检查服务地址。" })
    }
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.iframe?.contentWindow || event.source !== this.iframe.contentWindow) return

    let target: URL
    try {
      target = toServiceUrl(this.plugin.settings.serviceUrl, true)
    } catch {
      return
    }
    if (event.origin !== target.origin) return

    if (isBridgeReadyMessage(event.data)) {
      this.ready = true
      this.setStatus("已连接，等待笔记", "ready")
      if (this.pendingSync || this.plugin.settings.autoSync) {
        await this.syncActiveNote(true)
      }
      return
    }

    if (isBridgeLoadedMessage(event.data)) {
      const file = this.plugin.getCurrentMarkdownFile()
      this.setStatus(file ? `已同步：${file.basename}` : "同步完成", "ready")
    }
  }

  private setStatus(message: string, state: "idle" | "loading" | "ready" | "error"): void {
    if (!this.statusEl) return
    this.statusEl.setText(message)
    this.statusEl.dataset.state = state
    this.statusEl.dataset.visible =
      state === "error" || state === "idle" || (!this.ready && state === "loading")
        ? "true"
        : "false"
  }
}

class BloomtypeSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: BloomtypePlugin) {
    super(plugin.app, plugin)
  }

  getSettingDefinitions(): SettingDefinitionItem<BloomtypeSettingKey>[] {
    return [
      {
        name: "数据与隐私",
        desc: "插件会把当前 Markdown 笔记注入 Bloomtype 页面，不调用额外上传接口。远程地址必须使用 HTTPS。",
      },
      {
        name: "Bloomtype 服务地址",
        desc: "默认使用 mp.autoaihub.cn；本机开发可填 http://localhost:3000。",
        control: {
          type: "text",
          key: "serviceUrl",
          defaultValue: DEFAULT_SERVICE_URL,
          placeholder: DEFAULT_SERVICE_URL,
          validate: validateServiceUrl,
        },
      },
      {
        name: "自动同步当前笔记",
        desc: "切换笔记或编辑当前笔记后，自动刷新 Bloomtype 中的文稿。",
        control: {
          type: "toggle",
          key: "autoSync",
          defaultValue: DEFAULT_SETTINGS.autoSync,
        },
      },
      {
        name: "应用设置",
        desc: "重新载入已经打开的 Bloomtype 侧栏。",
        action: () => {
          this.plugin.reloadOpenViews()
          new Notice("Bloomtype 已重新载入")
        },
      },
    ]
  }

  getControlValue(key: string): unknown {
    if (key === "serviceUrl") return this.plugin.settings.serviceUrl
    if (key === "autoSync") return this.plugin.settings.autoSync
    return undefined
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "serviceUrl" && typeof value === "string") {
      this.plugin.settings.serviceUrl = value.trim()
    } else if (key === "autoSync" && typeof value === "boolean") {
      this.plugin.settings.autoSync = value
    } else {
      return
    }

    await this.plugin.saveSettings()
  }
}

export default class BloomtypePlugin extends Plugin {
  settings: BloomtypeSettings = DEFAULT_SETTINGS
  private currentMarkdownFile: TFile | null = null
  private syncTimer: number | null = null

  async onload(): Promise<void> {
    await this.loadSettings()

    this.registerView(VIEW_TYPE_BLOOMTYPE, (leaf) => new BloomtypeView(leaf, this))
    this.addSettingTab(new BloomtypeSettingTab(this))

    this.addRibbonIcon("palette", "打开 Bloomtype 排版", () => {
      void this.activateView()
    })

    this.addCommand({
      id: "open-bloomtype",
      name: "打开排版工作台",
      callback: () => {
        void this.activateView()
      },
    })

    this.addCommand({
      id: "sync-current-note",
      name: "同步当前笔记到排版工作台",
      checkCallback: (checking) => {
        if (!this.getCurrentMarkdownFile()) return false
        if (!checking) {
          void this.activateView().then(() => this.syncOpenViews(true))
        }
        return true
      },
    })

    this.addCommand({
      id: "reload-bloomtype-view",
      name: "重新加载排版预览",
      callback: () => {
        this.reloadOpenViews()
        new Notice("Bloomtype 预览已重新加载")
      },
    })

    this.addCommand({
      id: "open-bloomtype-in-browser",
      name: "在浏览器打开排版工作台",
      callback: () => {
        try {
          window.open(toServiceUrl(this.settings.serviceUrl, false).toString(), "_blank")
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "服务地址无效")
        }
      },
    })

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.extension === "md") this.currentMarkdownFile = file
        if (this.settings.autoSync) this.scheduleSync(80)
      }),
    )

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const active = this.app.workspace.getActiveFile()
        if (active?.extension === "md") this.currentMarkdownFile = active
        if (this.settings.autoSync) this.scheduleSync(120)
      }),
    )

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (
          this.settings.autoSync &&
          file instanceof TFile &&
          file.extension === "md" &&
          file.path === this.getCurrentMarkdownFile()?.path
        ) {
          this.scheduleSync(450)
        }
      }),
    )

    this.app.workspace.onLayoutReady(() => {
      const active = this.app.workspace.getActiveFile()
      if (active?.extension === "md") this.currentMarkdownFile = active
    })
  }

  onunload(): void {
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
  }

  getCurrentMarkdownFile(): TFile | null {
    const active = this.app.workspace.getActiveFile()
    if (active?.extension === "md") this.currentMarkdownFile = active
    return this.currentMarkdownFile
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  reloadOpenViews(): void {
    this.getOpenViews().forEach((view) => view.reloadService())
  }

  private async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData()
    this.settings = parseSettings(stored)
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMTYPE)[0]
    let leaf = existing

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? undefined
      if (!leaf) {
        new Notice("无法创建 Bloomtype 侧栏")
        return
      }
      await leaf.setViewState({ type: VIEW_TYPE_BLOOMTYPE, active: true })
    }

    await this.app.workspace.revealLeaf(leaf)
    await this.syncOpenViews(true)
  }

  private scheduleSync(delay: number): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer)
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null
      void this.syncOpenViews(false)
    }, delay)
  }

  private async syncOpenViews(force: boolean): Promise<void> {
    await Promise.all(this.getOpenViews().map((view) => view.syncActiveNote(force)))
  }

  private getOpenViews(): BloomtypeView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_BLOOMTYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is BloomtypeView => view instanceof BloomtypeView)
  }
}

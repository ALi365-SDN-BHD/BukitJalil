/** Base locale: its shape defines the message type every other locale must match (plan 10.1). */
const zhCN = {
  app: {
    name: "BukitJalil",
  },
  sidebar: {
    title: "网站",
    empty: "还没有网站",
    newSite: "新建网站",
    importSite: "导入网站",
  },
  conversation: {
    title: "对话",
    placeholder: "选择一个网站，开始和 AI 对话",
  },
  panel: {
    title: "面板",
    preview: "预览",
    changes: "改动",
    files: "文件",
    config: "配置",
    theme: "主题",
    data: "数据",
    empty: "选择网站后在这里查看{panel}",
  },
  status: {
    checking: "正在检查环境…",
    gitOk: "git {version}",
    gitMissing: "没有找到 git",
    gitTooOld: "git 版本 {version} 太旧，需要 2.38 或更高",
    unreachable: "连接不到 BukitJalil 服务",
  },
  settings: {
    language: "界面语言",
    saveFailed: "保存失败：{reason}",
  },
  errors: {
    "auth.required": "登录已失效：在运行 BukitJalil 的终端里按回车，打开新打印的地址",
    "request.bad_host": "请求的地址不被允许",
    "request.bad_origin": "请求来源不被允许",
    "request.bad_content_type": "请求格式不正确",
    "request.missing_csrf_header": "请求缺少安全标记",
    "request.cors_not_allowed": "不允许跨源请求",
    "request.invalid_body": "请求内容无效",
    "request.not_found": "接口不存在",
    "server.internal": "服务内部错误",
    "bukit.install_running": "Bukit 正在安装中",
    "bukit.unsupported_platform": "当前平台没有官方 Bukit 安装包：请自行编译 Bukit，并在设置里填写路径",
  },
};

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof zhCN>;
export default zhCN satisfies Messages;

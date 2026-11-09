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
  },
  errors: {
    "auth.required": "登录已失效，请使用终端里打印的地址重新打开",
    "auth.bad_token": "链接无效或已过期",
    "request.bad_host": "请求的地址不被允许",
    "request.bad_origin": "请求来源不被允许",
    "request.bad_content_type": "请求格式不正确",
    "request.missing_csrf_header": "请求缺少安全标记",
    "request.cors_not_allowed": "不允许跨源请求",
    "request.invalid_body": "请求内容无效",
    "request.not_found": "接口不存在",
    "server.internal": "服务内部错误",
  },
};

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof zhCN>;
export default zhCN satisfies Messages;

# Visora AI

一个面向 `cc-relay + HyperFrames` 的在线视频自动生成工作台原型。

## 功能

- 输入主题并自动提炼成 brief
- 自动生成视频大纲和场景列表
- 通过本地 `cc-relay` 代理请求真实模型
- 生成 `HyperFrames` 配置预览
- 支持主题优化、场景追加、项目重命名、JSON 导出

## 启动

1. 先确认你的 `cc-relay` 已运行在 `http://127.0.0.1:4446`
2. 启动本地前端代理和静态站点：

```bash
node server.js
```

3. 打开 `http://127.0.0.1:4173`

## cc-relay 地址

前端默认会使用：

```text
http://127.0.0.1:4446/relay/v1/chat/completions
```

如果你的 relay 只填写了 host，后端会自动补上 `/relay/v1/chat/completions`。

## 说明

如果 relay 临时不可用，系统会自动回退到本地生成逻辑，保证工作流不中断。

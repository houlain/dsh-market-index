# dsh-market-index

DSH（DeepSeek Harness）插件市场 **索引源**（格式 1），供「插件」页 →「发现」标签页读取。
官方市场本身不带任何内容，它只读你添加的索引源；本仓库就是那份索引源，托管在 GitHub 上，所以**不需要本机任何常驻进程**。

在「插件」页 →「发现」→「+ 添加索引源」，添加其中一条或两条：

| 索引源 URL | 内容 |
|---|---|
| `https://raw.githubusercontent.com/houlain/dsh-market-index/main/catalog.json` | **社区插件目录：400 个外部插件**，含 23 个分类与 10 个能力标签，用于浏览 / 搜索 / 安装 |
| `https://raw.githubusercontent.com/houlain/dsh-market-index/main/index.json` | 精选清单：8 个已装插件及其版本、兼容范围 |

## catalog.json 是怎么来的

数据源是社区目录 [`awesome-dsh-plugin.com/plugins.json`](https://awesome-dsh-plugin.com/plugins.json)（社区市场用的同一份），由 [`build-catalog.mjs`](build-catalog.mjs) 转换并逐条核验：

* 5945 行 → 2971 个不同 npm 包 → 按下载量取前 400；
* **每一条都到 npm 逐个校验**：包存在、该精确版本确实发布过；查不到的一律丢弃，不编造（本次 400/400 通过）；
* `publishTimestamp` 取自 npm 自己的 `time[version]`，不是社区文件里的日期；
* 同名包去重，保留下载量更高的一条。

## 安全取向

1. 只用 **npm 精确版本**：`source.type = "npm"`，安装 spec 固定为 `包名@版本`；不含 git / tarball / 路径来源。
2. registry 固定 `https://registry.npmjs.org/`。
3. `engines.dsh` **抄自插件自身声明**（该版本的 `@deepseek-ai/dsh-*` peer 要求完全一致时原样写入），且只在宿主确实满足时才写，否则省略——省略只是不过滤，安装时宿主的 peer 门仍然生效。
4. 写入前用**宿主自己的校验器**（`@deepseek-ai/dsh-plugin-market-index`）验一遍，不通过就不产出。
5. 卡片上的能力标签（`shell`、`fs-write`、`credentials`、`dynamic-code`、`network`、`subagent`、`llm`…）来自社区目录的能力检查，属于**安装前的风险提示**，不是安全背书。
6. 索引里不含图标、不含内联数据、不含可执行载荷。

## 重新生成 / 更新

```bash
node build-catalog.mjs 400        # 刷新外部目录（数字 = 取前多少个；注册表里可校验的共 2971 个）
node build-index.mjs              # 刷新精选清单
node verify-index.mjs catalog.json   # 宿主校验器复验，退出码 0 = 通过
```

`node_modules/` 里是从运行中的 DSH 取出的校验器副本（`semver` + `dsh-package-manifest` + `dsh-plugin-market-index`），因此校验可离线复现，不需要联网安装依赖。

## 边界

* 这是**个人维护的索引，不是官方索引**；「发现」页只能安装/卸载，**没有升级功能**（升级走「插件市场」或手动 pnpm）。
* 社区目录的版本号可能落后于 npm 最新版（目录更新有延迟）。
* 列出的都是第三方插件，安装后以你的权限运行；请结合卡片上的能力标签自行判断。

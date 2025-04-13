# Web3 任务执行系统

该系统能够执行多种Web3任务，包括FractionAI平台的任务和其他链上操作。

## 主要功能

- 多账号并行执行任务
- 支持各种验证码服务 (2captcha, anticaptcha, capmonster)
- 支持动态代理配置
- 可配置的任务排队和调度
- 详细的日志记录
- 错误处理和自动重试

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

复制`.env.example`文件为`.env`，并根据需要修改配置：

```bash
cp .env.example .env
```

### 3. 配置私钥

创建一个`private_keys.txt`文件，每行放置一个私钥：

```
# 这是私钥文件，每行一个私钥（可以添加注释，以#开头）
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
3456789012abcdef3456789012abcdef3456789012abcdef3456789012abcdef
```

### 4. 配置动态代理

在`.env`文件中配置代理服务器：

```
USE_PROXY=true
USE_DYNAMIC_PROXY=true
PROXY_HOST=your-proxy-host.com
PROXY_PORT=1080
PROXY_USERNAME=username
PROXY_PASSWORD=password
```

### 5. 运行

```bash
node src/main.js
```

## 配置参数

### 私钥配置

- `PRIVATE_KEY_FILE`: 私钥文件路径，一行一个私钥

### 代理配置

- `USE_PROXY`: 是否使用代理 (true/false)
- `USE_DYNAMIC_PROXY`: 是否使用动态代理 (true/false)
- `PROXY_HOST`: 代理服务器主机名
- `PROXY_PORT`: 代理服务器端口
- `PROXY_USERNAME`: 代理服务器用户名 (可选)
- `PROXY_PASSWORD`: 代理服务器密码 (可选)

### 任务配置

- `TASK_SEQUENCE`: 任务执行顺序，逗号分隔
- `MAX_GAMES`: 最大游戏次数
- `ENTRY_FEE`: 创建对战的费用

### API配置

- `API_BASE_URL`: 通用API基础URL
- `FRACTION_API_URL`: FractionAI服务API地址

### 验证码配置

- `CAPTCHA_SERVICE`: 验证码服务提供商 (2captcha, anticaptcha, capmonster)
- `CAPTCHA_API_KEY`: 验证码服务API密钥
- `HCAPTCHA_SITE_KEY`: hCaptcha站点密钥
- `RECAPTCHA_SITE_KEY`: reCAPTCHA站点密钥

## 项目结构

```
.
├── src                 # 源代码目录
│   ├── config          # 配置文件
│   │   └── index.js
│   ├── core            # 核心功能模块
│   │   ├── EthSigner.js     # 以太坊签名工具
│   │   ├── KeyManager.js    # 私钥管理器
│   │   └── ProxyManager.js  # 代理管理器
│   ├── services        # 服务模块
│   │   └── FractionAIHandler.js  # FractionAI平台处理器
│   ├── tasks           # 任务执行相关
│   │   └── worker.js   # 工作线程模块
│   ├── utils           # 工具类
│   │   ├── HttpClient.js    # HTTP客户端
│   │   └── Logger.js        # 日志管理器
│   └── main.js         # 程序入口
├── accounts.json       # 账号配置文件
├── proxies.txt         # 代理配置文件
├── .env.example        # 环境变量示例
├── package.json
└── README.md
```

## 安装

1. 克隆仓库

```bash
git clone https://github.com/yourusername/eth-multi-account-task-runner.git
cd eth-multi-account-task-runner
```

2. 安装依赖

```bash
npm install
```

3. 配置环境变量

```bash
cp .env.example .env
```

然后编辑`.env`文件，填写必要的配置信息。

4. 准备账号文件

创建`accounts.json`文件，格式如下：

```json
[
  {
    "privateKey": "0x...",
    "encrypted": false
  },
  {
    "privateKey": "0x...",
    "encrypted": false
  }
]
```

5. (可选) 准备代理文件

如果需要使用代理，创建`proxies.txt`文件，每行一个代理，格式为`ip:port`或`ip:port:username:password`。

## 使用方法

### 基本运行

```bash
npm start
```

### 开发模式（自动重启）

```bash
npm run dev
```

### 清理日志

```bash
npm run clean
```

## 配置选项

主要配置位于`src/config/index.js`文件中，也可以通过环境变量进行设置。

### 核心配置

- `ACCOUNTS_FILE` - 账号文件路径
- `USE_PROXY` - 是否使用代理 (true/false)
- `PROXY_FILE` - 代理文件路径
- `THREAD_COUNT` - 线程数量
- `ENCRYPTION_KEY` - 私钥加密密钥
- `API_BASE_URL` - API基础URL

### 日志配置

- `LOG_LEVEL` - 日志级别 (debug/info/warn/error)

### FractionAI配置

- `FRACTION_API_URL` - FractionAI API地址
- `MATCH_MODE` - 对战模式 (auto/manual)
- `MAX_GAMES` - 最大游戏局数
- `ENTRY_FEE` - 入场费（ETH）

## 安全提示

- 请勿在公共存储库中保存您的私钥
- 推荐使用环境变量或加密存储方式管理私钥
- 定期更换代理IP以避免IP封禁
- 使用不同的JA3指纹以减少被识别风险

## 扩展任务

要添加新的任务类型，请修改`config.js`中的`tasks`数组，并在`Worker`类中添加相应的任务处理方法。

## 贡献指南

欢迎贡献代码。请遵循以下步骤：

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开Pull Request

## 许可证

本项目采用MIT许可证。详见[LICENSE](LICENSE)文件。 
# FractionAI 自动化脚本

这是一个用于自动管理FractionAI平台智能代理的多账户自动化脚本。脚本支持多账户并行处理、自动化验证码识别、代理IP轮换以及自动执行一系列任务，如代理创建和自动匹配设置等。

## 功能特点

- **多账户支持**：可同时处理多个以太坊账户
- **多线程处理**：使用Node.js工作线程并行执行任务
- **验证码自动识别**：集成2captcha等验证码解决服务
- **代理IP支持**：支持使用HTTP代理进行请求
- **JA3指纹模拟**：通过cycletls实现浏览器指纹伪装
- **自动重试机制**：请求失败时自动重试，支持指数退避策略
- **完整任务链**：按顺序执行验证、获取代理、创建代理、管理自动匹配等任务
- **详细日志记录**：记录所有操作和错误信息，支持日志轮转

## 安装指南

### 系统要求

- Node.js 14.0+
- npm 或 yarn

### 安装步骤

1. 克隆仓库到本地

```bash
git clone [仓库URL]
cd fractionaiBot
```

2. 安装依赖

```bash
npm install
```

3. 创建配置文件

```bash
cp .env.example .env
```

4. 编辑`.env`文件，设置必要的参数（详见配置说明）

5. 准备私钥文件，每行一个私钥

```bash
echo "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" > private_keys.txt
```

## 配置说明

### 关键配置项

- **API配置**
  - `API_BASE_URL`: FractionAI API基础URL
  - `FRACTION_API_URL`: FractionAI主API地址
  - `FRACTION_API3_URL`: FractionAI API3地址

- **代理配置**
  - `USE_PROXY`: 是否启用代理
  - `PROXY_HOST`: 代理服务器地址
  - `PROXY_PORT`: 代理服务器端口
  - `PROXY_USERNAME`: 代理认证用户名
  - `PROXY_PASSWORD`: 代理认证密码

- **验证码配置**
  - `CAPTCHA_SERVICE`: 验证码服务提供商 (2captcha, anticaptcha, capmonster)
  - `CAPTCHA_API_KEY`: 验证码服务API密钥

- **任务配置**
  - `TASK_SEQUENCE`: 任务执行顺序，默认使用任务链
  - `TASK_MAX_RETRIES`: 任务最大重试次数
  - `STOP_ON_FAILURE`: 是否在任务失败时停止执行

- **FractionAI特定配置**
  - `MAX_GAMES`: 自动匹配最大游戏数量
  - `ENTRY_FEE`: 创建对战的费用
  - `MATCH_MODE`: 对战模式 (auto或manual)

### 私钥文件格式

`private_keys.txt`文件应包含以太坊私钥列表，每行一个私钥。支持以下格式：

```
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
3456789012abcdef3456789012abcdef3456789012abcdef3456789012abcdef
# 这是注释行，以#开头
```

## 使用方法

### 基本使用

启动脚本：

```bash
npm start
```

开发模式（自动重启）：

```bash
npm run dev
```

### 高级用法

1. **自定义任务执行**

   可以在`.env`文件中修改`TASK_SEQUENCE`变量来自定义任务执行顺序。默认使用完整任务链：

   ```
   TASK_SEQUENCE=fractionAI:executeTaskChain
   ```

   该任务链按顺序执行以下任务：
   - verify (验证用户身份)
   - getUserAgents (获取用户智能代理列表)
   - createAgent (如果没有代理则创建一个)
   - disableAutomatedMatchmaking (禁用自动匹配)
   - enableAutomatedMatchmaking (启用自动匹配)

2. **并发控制**

   调整`.env`文件中的`MAX_WORKERS`和`MAX_TASKS_PER_WORKER`来控制并发数量。

3. **日志管理**

   日志文件存储在`logs`目录中，可通过`.env`文件中的`LOG_LEVEL`设置日志详细程度。

   清理日志：
   ```bash
   npm run clean
   ```

## 故障排除

### 常见问题

1. **验证码识别失败**
   - 检查`CAPTCHA_API_KEY`是否正确
   - 确认验证码服务账户余额是否充足

2. **代理连接问题**
   - 验证代理服务器地址和端口是否正确
   - 检查代理认证信息是否正确
   - 尝试临时禁用代理：将`USE_PROXY`设为`false`

3. **区块链交易失败**
   - 确保私钥账户中有足够的ETH余额
   - 检查gasLimit和maxFeePerGas配置

4. **请求频率限制**
   - 调整`REQUEST_RATE_LIMIT`以减少请求频率
   - 增加`DELAY_BETWEEN_TASKS`的值

## 注意事项

1. 请勿在公共环境中保存未加密的私钥文件
2. 不建议设置过高的并发数，以避免触发API限制
3. 定期备份操作日志和结果
4. 以太坊交易会消耗燃料费，请确保账户余额充足

## 许可证

MIT License 
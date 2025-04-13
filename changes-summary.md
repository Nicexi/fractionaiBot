# 项目修改和新增内容总结

## 1. 新增文件

- **FractionAIHandler.js**: 处理FractionAI平台相关任务的类，包括获取用户资料、获取AI代理列表、创建和加入对战、检查对战状态、获取对战结果和领取奖励等功能。

## 2. 修改文件

### config.js

- 添加FractionAI相关API接口配置
- 新增FractionAI相关任务配置
- 增加FractionAI特定配置，如匹配模式、最大游戏局数、轮询间隔等
- 添加验证码服务配置

### .env.example

- 增加FractionAI相关环境变量配置
- 添加验证码服务配置项

### worker.js

- 整合FractionAIHandler类
- 添加FractionAI相关任务处理方法
- 在executeTask方法中增加对FractionAI任务的支持

### README.md

- 更新项目功能介绍，添加FractionAI整合说明
- 增加FractionAI相关环境变量说明
- 增加FractionAI功能详细说明和注意事项
- 更新任务配置示例，包含FractionAI任务

## 3. 主要新增功能

### FractionAI自动对战

1. **获取用户资料** (getProfile)
   - 通过签名验证获取用户信息

2. **获取AI代理列表** (getAgents)
   - 获取可用的AI代理，自动选择第一个作为默认代理

3. **创建对战** (createMatch)
   - 使用选择的AI代理创建新的对战
   - 支持验证码处理
   - 配置入场费

4. **加入对战** (joinMatch)
   - 如已创建对战，则使用已有的对战ID
   - 否则查找可用的对战并加入

5. **检查对战状态** (checkMatchStatus)
   - 根据配置的轮询间隔定期检查对战状态
   - 支持最大等待时间配置
   - 记录状态变化

6. **获取对战结果** (getMatchResult)
   - 获取对战结果
   - 判断是否获胜

7. **领取奖励** (claimRewards)
   - 如果获胜，自动领取奖励
   - 签名验证请求

### 验证码处理

- 支持常见验证码服务 (anticaptcha/twocaptcha)
- 通过配置可开启或关闭验证码功能

## 4. 使用流程

1. 配置账号和代理
2. 设置FractionAI相关环境变量
3. 根据需要启用或禁用任务
4. 启动程序
5. 程序将自动按顺序执行配置的任务，包括FractionAI相关任务
6. 任务结果会记录在日志中

## 5. 注意事项

- 使用前确保已在FractionAI官方网站注册账号并创建AI代理
- 确保ETH余额足够支付对战入场费
- 根据实际需求调整对战参数和验证码配置
- 遵守FractionAI平台的使用规则 
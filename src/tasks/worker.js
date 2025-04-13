/**
 * 工作线程模块
 * 负责执行具体的任务，包括签名和创建事件
 * 支持JA3指纹模拟和代理IP
 */
const { parentPort, workerData } = require('worker_threads');
const delay = require('delay');
const config = require('../config');
const EthSigner = require('../core/EthSigner');
const Logger = require('../utils/Logger');
const FractionAIHandler = require('../services/FractionAIHandler');
const HttpClient = require('../utils/HttpClient');

/**
 * 任务状态枚举
 */
const TaskStatus = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRYING: 'retrying'
};

class Worker {
    /**
     * 构造函数
     * @param {Object} account 账号信息，包含私钥和代理配置
     * @param {number} workerId 工作线程ID
     */
    constructor(account, workerId) {
        this.account = account;
        this.workerId = workerId;
        this.privateKey = account.privateKey;
        this.ethSigner = new EthSigner(this.privateKey);
        this.address = this.ethSigner.address;
        this.logger = new Logger(`Worker-${workerId}`);
        this.consecutiveErrors = 0;  // 连续错误计数
        this.taskResults = {};       // 任务结果记录
        this.metrics = {
            startTime: Date.now(),
            tasksCompleted: 0,
            tasksFailed: 0,
            totalRequests: 0,
            retries: 0
        };
        
        // 创建HTTP客户端
        this.httpClient = new HttpClient({
            proxy: this.account.proxy,
            maxRetries: config.network.maxRetries || 3,
            retryDelay: config.network.retryDelay || 2000,
            rateLimit: config.network.rateLimit || 20, // 每分钟最多20个请求
            timeout: config.network.timeout || 30000
        });
        
        // 初始化FractionAI处理器
        this.fractionAIHandler = new FractionAIHandler(
            this.httpClient, 
            this.ethSigner, 
            this.logger.child('FractionAI')
        );
        
        // 为这个线程设置随机延迟，避免所有线程同时请求
        this.initialDelay = 1000 + Math.floor(Math.random() * 4000); // 1-5秒随机延迟
        
        // 设置退出清理
        this._setupCleanup();
    }
    
    /**
     * 设置退出清理函数
     * @private
     */
    _setupCleanup() {
        const cleanup = async () => {
            try {
                this.logger.info(`工作线程 ${this.workerId} 正在清理资源...`);
                if (this.httpClient) {
                    await this.httpClient.close();
                }
            } catch (error) {
                this.logger.error(`资源清理失败: ${error.message}`);
            }
        };
        
        // 在Worker结束前尝试清理资源
        process.once('beforeExit', cleanup);
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
    }

    /**
     * 通用错误处理方法
     * @param {Function} taskFn 任务执行函数
     * @param {string} taskName 任务名称
     * @returns {Promise<Object>} 任务执行结果
     */
    async withErrorHandling(taskFn, taskName) {
        const startTime = Date.now();
        let taskStatus = TaskStatus.RUNNING;
        
        try {
            this.logger.info(`开始执行任务: ${taskName}`);
            this.metrics.totalRequests++;
            
            // 执行任务函数
            const result = await taskFn();
            
            // 重置连续错误计数
            this.consecutiveErrors = 0;
            taskStatus = TaskStatus.COMPLETED;
            this.metrics.tasksCompleted++;
            
            // 记录结果
            this.taskResults[taskName] = {
                status: taskStatus,
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                data: result
            };
            
            this.logger.info(`任务 ${taskName} 完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: result,
                status: taskStatus,
                address: this.address,
                taskName: taskName,
                duration: Date.now() - startTime
            };
        } catch (error) {
            // 增加连续错误计数
            this.consecutiveErrors++;
            taskStatus = TaskStatus.FAILED;
            this.metrics.tasksFailed++;
            
            // 记录失败结果
            this.taskResults[taskName] = {
                status: taskStatus,
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                error: error.message
            };
            
            this.logger.error(`任务 ${taskName} 失败 (连续错误: ${this.consecutiveErrors}/${config.errorHandling.maxConsecutiveErrors})`, error);
            
            // 如果连续错误次数过多，可能暂时阻止该账号的操作
            if (this.consecutiveErrors >= config.errorHandling.maxConsecutiveErrors) {
                const cooldownPeriod = config.errorHandling.cooldownPeriod || 300000; // 默认5分钟
                
                this.logger.warn(`账号 ${this.address} 连续错误次数过多，进入冷却期 ${cooldownPeriod/1000}秒`);
                
                await delay(cooldownPeriod);
                this.consecutiveErrors = 0;
            }
            
            return {
                success: false,
                error: error.message,
                status: taskStatus,
                address: this.address,
                taskName: taskName,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * 执行签名授权任务
     * 生成签名并发送到服务器进行验证
     * @returns {Promise<Object>} 任务执行结果
     */
    async sign() {
        return this.withErrorHandling(async () => {
            // 构造需要签名的消息
            const timestamp = Date.now();
            const message = `Sign message for authentication ${timestamp}`;
            
            this.logger.debug(`准备签名消息: ${message}`);
            
            // 使用 EthSigner 进行签名
            const signature = await this.ethSigner.signMessage(message);
            
            this.logger.debug(`签名成功，生成签名: ${signature.substring(0, 20)}...`);
            
            // 验证签名是否正确
            const isValid = this.ethSigner.verifySignature(message, signature);
            if (!isValid) {
                this.logger.error('本地签名验证失败');
                throw new Error('本地签名验证失败');
            }
            
            this.logger.debug('本地签名验证通过，准备发送到服务器');
            
            // 增加重试和超时机制
            const maxRetries = 3;
            let retryCount = 0;
            let lastError = null;
            
            while (retryCount <= maxRetries) {
                try {
                    // 使用HTTP客户端发送请求
                    const response = await this.httpClient.post(
                        `${config.api.baseUrl}${config.api.endpoints.sign}`,
                        {
                            address: this.address,
                            message: message,
                            signature: signature,
                            timestamp: timestamp
                        }
                    );
                    
                    return response.data;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    this.metrics.retries++;
                    
                    if (retryCount <= maxRetries) {
                        const retryDelay = Math.pow(2, retryCount) * 1000; // 指数退避
                        this.logger.warn(`签名请求失败，${retryCount}/${maxRetries}次重试，等待${retryDelay}ms`);
                        await delay(retryDelay);
                    }
                }
            }
            
            // 如果所有重试都失败，抛出最后一个错误
            throw lastError || new Error('签名授权请求失败，达到最大重试次数');
        }, "签名授权");
    }

    /**
     * 执行创建事件任务
     * 签名交易数据并发送到服务器
     * @returns {Promise<Object>} 任务执行结果
     */
    async createEvent() {
        return this.withErrorHandling(async () => {
            // 创建交易数据
            const transactionData = {
                timestamp: Date.now(),
                address: this.address,
                eventType: 'custom_event',
                data: {
                    action: 'perform_task',
                    nonce: Math.floor(Math.random() * 1000000)
                }
            };
            
            this.logger.debug(`准备创建事件，交易数据: ${JSON.stringify(transactionData)}`);
            
            // 将交易数据转换为可签名的消息
            const message = JSON.stringify(transactionData);
            
            // 使用 EthSigner 进行签名
            const signature = await this.ethSigner.signMessage(message);
            
            this.logger.debug(`事件数据签名成功: ${signature.substring(0, 20)}...`);
            
            // 验证签名是否正确
            const isValid = this.ethSigner.verifySignature(message, signature);
            if (!isValid) {
                this.logger.error('创建事件本地签名验证失败');
                throw new Error('本地签名验证失败');
            }
            
            this.logger.debug('创建事件签名验证通过，准备发送到服务器');
            
            // 使用HTTP客户端发送请求
            const response = await this.httpClient.post(
                `${config.api.baseUrl}${config.api.endpoints.createEvent}`,
                {
                    ...transactionData,
                    signature: signature
                }
            );
            
            return response.data;
        }, "创建事件");
    }
    
    /**
     * 处理FractionAI相关任务
     * @param {string} taskType 任务类型
     * @returns {Promise<Object>} 任务执行结果
     */
    async handleFractionAITask(taskType) {
        try {
            if (!this.fractionAIHandler) {
                this.logger.error('FractionAI处理器未初始化');
                return { success: false, error: 'FractionAI处理器未初始化' };
            }
            
            this.logger.info(`准备执行FractionAI任务: ${taskType}`);
            
            switch (taskType) {
                case 'verify':
                    return await this.fractionAIHandler.verify();
                case 'getUserAgents':
                    return await this.fractionAIHandler.getUserAgents();
                case 'createAgent':
                    return await this.fractionAIHandler.createAgent();
                case 'enableAutomatedMatchmaking':
                    return await this.fractionAIHandler.enableAutomatedMatchmaking();
                case 'disableAutomatedMatchmaking':
                    return await this.fractionAIHandler.disableAutomatedMatchmaking();
                case 'checkAutomationStatus':
                    return await this.fractionAIHandler.checkAutomationStatus();
                case 'getProfile':
                    return await this.fractionAIHandler.getProfile();
                case 'getAgents':
                    return await this.fractionAIHandler.getAgents();
                case 'createMatch':
                    return await this.fractionAIHandler.createMatch();
                case 'joinMatch':
                    return await this.fractionAIHandler.joinMatch();
                case 'checkMatchStatus':
                    return await this.fractionAIHandler.checkMatchStatus();
                case 'getMatchResult':
                    return await this.fractionAIHandler.getMatchResult();
                case 'claimRewards':
                    return await this.fractionAIHandler.claimRewards();
                default:
                    this.logger.error(`未知的FractionAI任务类型: ${taskType}`);
                    return { success: false, error: `未知的FractionAI任务类型: ${taskType}` };
            }
        } catch (error) {
            this.logger.error(`执行FractionAI任务 ${taskType} 失败`, error);
            
            // 检查是否是验证码致命错误
            if (error.isCaptchaFatalError) {
                this.logger.error(`验证码识别连续失败超过最大重试次数，停止工作线程 ${this.workerId}`);
                
                // 标记线程状态为失败
                this.status = 'failed';
                this.errorMessage = '验证码识别连续失败，任务终止';
                
                // 返回严重错误，上层可以据此决定是否继续执行后续任务
                return {
                    success: false,
                    error: error.message,
                    fatalError: true,
                    taskType,
                    address: this.address
                };
            }
            
            return {
                success: false,
                error: error.message,
                taskType,
                address: this.address
            };
        }
    }

    /**
     * 执行指定任务
     * @param {string} taskType 任务类型
     * @param {number} retryCount 已重试次数
     * @param {number} retryDelay 重试延迟时间(ms)
     * @returns {Promise<Object>} 任务执行结果
     */
    async executeTask(taskType, retryCount = 0, retryDelay = 0) {
        try {
            // 如果需要重试，等待指定时间
            if (retryCount > 0 && retryDelay > 0) {
                this.logger.info(`任务 ${taskType} 第 ${retryCount} 次重试，等待 ${retryDelay}ms`);
                await delay(retryDelay);
            }
            
            // 根据任务类型执行不同的任务
            switch (taskType) {
                case 'sign':
                    return await this.sign();
                    
                case 'createEvent':
                    return await this.createEvent();
                    
                // 添加其他任务类型
                case 'fractionAI:verify':
                    return await this.handleFractionAITask('verify');
                
                case 'fractionAI:diagnoseApi':
                    return await this.handleFractionAITask('diagnoseApi');
                    
                case 'fractionAI:getUserAgents':
                    return await this.handleFractionAITask('getUserAgents');
                    
                case 'fractionAI:checkAutomationStatus':
                    return await this.handleFractionAITask('checkAutomationStatus');
                    
                case 'fractionAI:createAgent':
                    return await this.handleFractionAITask('createAgent');
                    
                case 'fractionAI:enableAutomatedMatchmaking':
                    return await this.handleFractionAITask('enableAutomatedMatchmaking');
                    
                case 'fractionAI:disableAutomatedMatchmaking':
                    return await this.handleFractionAITask('disableAutomatedMatchmaking');
                    
                case 'fractionAI:getProfile':
                    return await this.handleFractionAITask('getProfile');
                
                case 'fractionAI:getAgents':
                    return await this.handleFractionAITask('getAgents');
                
                case 'fractionAI:createMatch':
                    return await this.handleFractionAITask('createMatch');
                
                case 'fractionAI:joinMatch':
                    return await this.handleFractionAITask('joinMatch');
                
                case 'fractionAI:checkMatchStatus':
                    return await this.handleFractionAITask('checkMatchStatus');
                
                case 'fractionAI:getMatchResult':
                    return await this.handleFractionAITask('getMatchResult');
                
                case 'fractionAI:claimRewards':
                    return await this.handleFractionAITask('claimRewards');
                
                default:
                    throw new Error(`未知的任务类型: ${taskType}`);
            }
        } catch (error) {
            this.logger.error(`执行任务 ${taskType} 失败: ${error.message}`);
            
            // 检查是否是验证码致命错误
            if (error.isCaptchaFatalError) {
                this.logger.error(`验证码识别连续失败超过最大重试次数，停止工作线程 ${this.workerId}`);
                
                // 标记线程状态为失败
                this.status = 'failed';
                this.errorMessage = '验证码识别连续失败，任务终止';
                
                // 返回致命错误，上层会停止执行后续任务
                return {
                    success: false,
                    error: error.message,
                    fatalError: true,
                    taskType,
                    address: this.address
                };
            }
            
            // 递增连续错误计数
            this.consecutiveErrors++;
            
            // 检查是否达到最大连续错误阈值
            if (this.consecutiveErrors >= config.errorHandling.maxConsecutiveErrors) {
                this.logger.error(`连续错误达到阈值(${config.errorHandling.maxConsecutiveErrors})，进入冷却期`);
                
                // 进入冷却期
                await delay(config.errorHandling.cooldownPeriod);
                
                // 重置连续错误计数
                this.consecutiveErrors = 0;
            }
            
            // 检查是否还可以重试
            const maxRetries = config.tasks.maxRetries || 3;
            if (retryCount < maxRetries) {
                // 计算下一次重试的延迟时间（指数退避）
                const nextRetryDelay = retryDelay === 0 
                    ? config.tasks.initialRetryDelay || 2000
                    : retryDelay * 2;
                
                this.logger.warn(`将在 ${nextRetryDelay}ms 后重试任务 ${taskType}，重试次数 ${retryCount + 1}/${maxRetries}`);
                
                // 递归调用自身进行重试
                return this.executeTask(taskType, retryCount + 1, nextRetryDelay);
            }
            
            // 达到最大重试次数，返回失败结果
            return {
                success: false,
                error: error.message,
                taskType,
                address: this.address
            };
        }
    }

    /**
     * 执行指定的所有任务
     * @returns {Promise<Object>} 所有任务的执行结果
     */
    async executeAllTasks() {
        try {
            // 首先等待初始随机延迟，避免所有线程同时开始
            this.logger.info(`工作线程 ${this.workerId} 启动，等待 ${this.initialDelay}ms 后开始执行任务`);
            await delay(this.initialDelay);
            
            // 获取需要执行的任务列表
            const tasksToExecute = config.tasks.sequence || ['sign', 'createEvent'];
            const taskResults = {};
            let allTasksSuccessful = true;

            // 顺序执行所有任务
            for (const taskType of tasksToExecute) {
                // 执行任务并获取结果
                const result = await this.executeTask(taskType);
                
                // 保存任务结果
                taskResults[taskType] = result;
                
                // 如果遇到验证码致命错误，立即停止所有任务
                if (result.fatalError) {
                    this.logger.error(`任务 ${taskType} 遇到致命错误，停止所有后续任务`);
                    allTasksSuccessful = false;
                    break;
                }
                
                // 如果任务失败且配置了失败时停止
                if (!result.success && config.tasks.stopOnFailure) {
                    this.logger.warn(`任务 ${taskType} 失败，根据配置停止后续任务`);
                    allTasksSuccessful = false;
                    break;
                }
                
                // 任务之间添加延迟，避免请求过于频繁
                if (config.tasks.delayBetweenTasks && tasksToExecute.indexOf(taskType) < tasksToExecute.length - 1) {
                    const delayTime = typeof config.tasks.delayBetweenTasks === 'number' 
                        ? config.tasks.delayBetweenTasks 
                        : 1000 + Math.floor(Math.random() * 2000); // 默认1-3秒随机延迟
                        
                    this.logger.debug(`任务 ${taskType} 完成，等待 ${delayTime}ms 后执行下一个任务`);
                    await delay(delayTime);
                }
            }
            
            // 汇总所有任务结果
            const summary = {
                success: allTasksSuccessful,
                address: this.address,
                workerId: this.workerId,
                tasks: taskResults,
                metrics: {
                    ...this.metrics,
                    endTime: Date.now(),
                    totalDuration: Date.now() - this.metrics.startTime
                }
            };
            
            // 在完成所有任务后关闭HTTP客户端
            await this.httpClient.close();
            
            return summary;
        } catch (error) {
            this.logger.error('执行所有任务时发生错误', error);
            
            // 确保HTTP客户端被关闭
            try {
                await this.httpClient.close();
            } catch (closeError) {
                this.logger.error('关闭HTTP客户端时发生错误', closeError);
            }
            
            return {
                success: false,
                address: this.address,
                workerId: this.workerId,
                error: error.message,
                metrics: {
                    ...this.metrics,
                    endTime: Date.now(),
                    totalDuration: Date.now() - this.metrics.startTime
                }
            };
        }
    }
}

/**
 * 工作线程的主入口点
 */
async function main() {
    try {
        // 从workerData获取工作线程ID和账号信息
        const { workerId, account } = workerData;
        
        // 创建worker实例
        const worker = new Worker(account, workerId);
        
        // 执行所有配置的任务
        const result = await worker.executeAllTasks();
        
        // 将结果发送回主线程
        parentPort.postMessage(result);
    } catch (error) {
        console.error(`工作线程执行失败: ${error.message}`, error);
        
        // 发送错误信息回主线程
        parentPort.postMessage({
            success: false,
            error: error.message,
            stack: error.stack
        });
    } finally {
        // 确保工作线程正常退出
        process.exit(0);
    }
}

// 启动工作线程主函数
main().catch(error => {
    console.error('工作线程主函数异常:', error);
    process.exit(1);
}); 
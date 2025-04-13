/**
 * 多账号多线程任务执行系统主程序
 * 负责加载账号、创建工作线程和管理执行过程
 */
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const util = require('util');
const config = require('./config');
const EthSigner = require('./core/EthSigner');
const ProxyManager = require('./core/ProxyManager');
const Logger = require('./utils/Logger');
const KeyManager = require('./core/KeyManager');
require('dotenv').config();

// 任务状态常量
const TaskStatus = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

class TaskManager {
    /**
     * 构造函数
     * 初始化任务管理器的状态
     */
    constructor() {
        this.workers = [];      // 工作线程列表
        this.results = [];      // 任务结果列表
        this.accounts = [];     // 账号列表
        this.logger = new Logger('TaskManager');
        this.proxyManager = new ProxyManager();
        this.keyManager = new KeyManager(config.auth.privateKeyFile);
        this.startTime = Date.now();
        this.isRunning = false;
        this.metrics = {
            totalAccounts: 0,
            activeThreads: 0,
            completedTasks: 0,
            failedTasks: 0,
            startTime: this.startTime,
            endTime: null
        };
        
        // 设置退出处理
        this._setupExitHandlers();
    }

    /**
     * 设置程序退出处理
     * @private
     */
    _setupExitHandlers() {
        // 正常退出处理
        process.on('SIGINT', this.handleExit.bind(this));
        process.on('SIGTERM', this.handleExit.bind(this));
        
        // 未捕获异常处理
        process.on('uncaughtException', (error) => {
            this.logger.error('未捕获的异常', error);
            this.handleExit();
        });
        
        // Promise拒绝处理
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error(`未处理的Promise拒绝: ${reason}`);
            if (reason instanceof Error) {
                this.logger.error(`堆栈: ${reason.stack}`);
            }
        });
    }

    /**
     * 加载账号数据
     * 从配置的文件路径读取账号信息
     */
    loadAccounts() {
        try {
            // 使用KeyManager加载和解密账号
            this.accounts = this.keyManager.loadAccounts();
            
            if (this.accounts.length === 0) {
                this.logger.error('未找到有效账号，请检查账号文件');
                throw new Error('未找到有效账号');
            }
            
            // 为账号分配代理
            this.accounts = this.proxyManager.assignProxiesToAccounts(this.accounts);
            
            this.metrics.totalAccounts = this.accounts.length;
            this.logger.info(`成功加载了 ${this.accounts.length} 个账号`);
        } catch (error) {
            this.logger.error('加载账号数据失败', error);
            throw error;
        }
    }
    
    /**
     * 处理程序退出
     * 保存执行结果并清理资源
     */
    async handleExit() {
        if (this._exiting) return; // 防止多次调用
        this._exiting = true;
        
        this.logger.info('收到退出信号，正在清理资源...');
        
        // 结束所有工作线程
        await this.terminateWorkers();
        
        // 保存结果
        this.saveResults();
        
        this.logger.info('退出完成');
        
        // 延迟退出，确保日志写入
        setTimeout(() => process.exit(0), 1000);
    }
    
    /**
     * 终止所有工作线程
     */
    async terminateWorkers() {
        if (this.workers.length === 0) return;
        
        this.logger.info(`正在终止 ${this.workers.length} 个工作线程...`);
        
        const terminatePromises = this.workers.map(worker => {
            return new Promise(resolve => {
                worker.on('exit', () => resolve());
                worker.terminate();
            });
        });
        
        try {
            // 等待所有工作线程终止，最多等待5秒
            await Promise.race([
                Promise.all(terminatePromises),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);
        } catch (error) {
            this.logger.error('终止工作线程时发生错误', error);
        }
        
        this.workers = [];
        this.logger.info('所有工作线程已终止');
    }
    
    /**
     * 保存执行结果到文件
     */
    saveResults() {
        try {
            const now = new Date();
            const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
            const resultsPath = path.join(config.logging.folderPath, `results_${timestamp}.json`);
            
            // 更新执行统计信息
            this.metrics.endTime = Date.now();
            
            const executionStats = {
                startTime: new Date(this.startTime).toISOString(),
                endTime: new Date().toISOString(),
                duration: (this.metrics.endTime - this.startTime) / 1000, // 秒
                totalAccounts: this.metrics.totalAccounts,
                completedTasks: this.metrics.completedTasks,
                failedTasks: this.metrics.failedTasks,
                successRate: this.metrics.totalAccounts > 0 
                    ? (this.metrics.completedTasks / this.metrics.totalAccounts * 100).toFixed(2) + '%' 
                    : '0%'
            };
            
            const resultsWithStats = {
                stats: executionStats,
                results: this.results
            };
            
            // 确保目录存在
            const targetDir = path.dirname(resultsPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            fs.writeFileSync(resultsPath, JSON.stringify(resultsWithStats, null, 2));
            this.logger.info(`执行结果已保存至 ${resultsPath}`);
        } catch (error) {
            this.logger.error('保存执行结果失败', error);
        }
    }

    /**
     * 启动任务管理器
     * 创建工作线程并执行任务
     */
    async start() {
        try {
            if (this.isRunning) {
                this.logger.warn('任务管理器已经在运行中');
                return;
            }
            
            this.isRunning = true;
            this.startTime = Date.now();
            this.metrics.startTime = this.startTime;
            
            this.logger.info('开始启动任务管理器...');
            
            // 加载账号数据
            this.loadAccounts();
            
            if (this.accounts.length === 0) {
                this.logger.error('未找到任何账号数据');
                throw new Error('未找到任何账号数据');
            }
            
            this.logger.info('开始启动工作线程...');
            
            // 确定要启动的线程数量，不超过账号数量和配置的最大线程数
            const maxThreads = config.concurrency.maxWorkers || 5;
            const threadCount = Math.min(maxThreads, this.accounts.length);
            this.logger.info(`将启动 ${threadCount} 个工作线程`);
            
            // 创建指定数量的工作线程
            const workerPromises = [];
            
            for (let i = 0; i < threadCount; i++) {
                const account = this.accounts[i];
                const address = this.getAddressFromPrivateKey(account.privateKey);
                
                this.logger.info(`启动工作线程 ${i + 1}，使用账号地址: ${address}`);
                
                // 创建工作线程
                const worker = new Worker(path.join(__dirname, 'tasks/worker.js'), {
                    workerData: { 
                        workerId: i + 1,
                        account: account
                    }
                });
                
                this.metrics.activeThreads++;

                // 设置消息处理
                worker.on('message', (message) => {
                    if (message.success) {
                        this.metrics.completedTasks++;
                        this.logger.info(`工作线程 ${i + 1} (${message.address}) 完成所有任务`);
                    } else {
                        this.metrics.failedTasks++;
                        this.logger.error(`工作线程 ${i + 1} 失败: ${message.error || 'Unknown error'}`);
                    }
                    
                    // 添加到结果列表
                    this.results.push({
                        ...message,
                        timestamp: new Date().toISOString(),
                        workerId: i + 1
                    });
                });

                // 设置错误处理
                worker.on('error', (error) => {
                    this.metrics.failedTasks++;
                    this.metrics.activeThreads--;
                    this.logger.error(`工作线程 ${i + 1} 发生错误`, error);
                });

                // 设置退出处理
                worker.on('exit', (code) => {
                    this.metrics.activeThreads--;
                    if (code !== 0) {
                        this.logger.error(`工作线程 ${i + 1} 异常退出，退出码: ${code}`);
                    } else {
                        this.logger.debug(`工作线程 ${i + 1} 正常退出`);
                    }
                });

                // 添加到工作线程列表
                this.workers.push(worker);
                
                // 创建Promise等待工作线程完成
                workerPromises.push(new Promise((resolve) => {
                    worker.on('exit', resolve);
                }));
            }

            // 等待所有工作线程完成
            this.logger.info('等待所有工作线程完成...');
            await Promise.all(workerPromises);

            this.logger.info('所有工作线程已完成任务');
            this.isRunning = false;
            this.metrics.endTime = Date.now();
            
            // 保存结果
            this.saveResults();
            this.printResults();
        } catch (error) {
            this.isRunning = false;
            this.logger.error('任务管理器启动失败', error);
            
            // 尝试清理资源
            await this.terminateWorkers();
            throw error;
        }
    }
    
    /**
     * 从私钥获取以太坊地址
     * @param {string} privateKey 私钥
     * @returns {string} 以太坊地址
     */
    getAddressFromPrivateKey(privateKey) {
        try {
            // 使用KeyManager获取地址
            return this.keyManager.getAddressFromPrivateKey(privateKey);
        } catch (error) {
            this.logger.error(`获取地址失败: ${privateKey.substring(0, 10)}...`, error);
            return `无效私钥 (${privateKey.substring(0, 10)}...)`;
        }
    }

    /**
     * 打印任务执行结果统计
     */
    printResults() {
        const duration = (this.metrics.endTime || Date.now()) - this.startTime;
        const successCount = this.results.filter(r => r.success).length;
        const failCount = this.results.filter(r => !r.success).length;
        const successRate = this.results.length > 0 ? (successCount / this.results.length * 100).toFixed(2) : 0;
        
        this.logger.info('\n===== 任务执行结果汇总 =====');
        this.logger.info(`总执行时间: ${(duration / 1000).toFixed(2)}秒`);
        this.logger.info(`总账号数: ${this.accounts.length}`);
        this.logger.info(`总执行数: ${this.results.length}`);
        this.logger.info(`成功数: ${successCount}`);
        this.logger.info(`失败数: ${failCount}`);
        this.logger.info(`成功率: ${successRate}%`);
        
        // 如果有失败的任务，打印失败原因
        if (failCount > 0) {
            this.logger.info('\n失败任务列表:');
            const failedTasks = this.results.filter(r => !r.success);
            
            failedTasks.forEach((task, index) => {
                this.logger.info(`${index + 1}. 工作线程 ${task.workerId || 'unknown'} (${task.address || 'unknown address'}): ${task.error || 'Unknown error'}`);
            });
        }
        
        this.logger.info('===== 汇总结束 =====\n');
    }
}

/**
 * 主程序入口点
 */
async function main() {
    // 设置unhandledRejection处理
    process.on('unhandledRejection', (reason, promise) => {
        console.error('未处理的Promise拒绝:', reason);
        if (reason instanceof Error) {
            console.error(reason.stack);
        }
    });
    
    // 初始化任务管理器
    const taskManager = new TaskManager();
    
    try {
        // 启动任务管理器
        await taskManager.start();
    } catch (error) {
        console.error('主程序执行失败:', error);
        process.exit(1);
    }
}

// 启动主程序
if (require.main === module) {
    main().catch(error => {
        console.error('程序启动失败:', error);
        process.exit(1);
    });
}

module.exports = TaskManager; 
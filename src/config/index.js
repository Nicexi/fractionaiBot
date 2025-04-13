/**
 * 统一配置管理
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 创建日志目录（如果不存在）
const logDir = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch (error) {
        console.warn(`警告: 无法创建日志目录: ${error.message}`);
    }
}

// 配置对象
const config = {
    // 日志配置
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        folderPath: process.env.LOG_FOLDER || './logs',
        maxLogFiles: parseInt(process.env.MAX_LOG_FILES, 10) || 10,
        maxLogSize: parseInt(process.env.MAX_LOG_SIZE, 10) || 10485760, // 10MB
        consoleOutput: process.env.CONSOLE_OUTPUT === 'true',
        fileOutput: process.env.FILE_OUTPUT !== 'false', // 默认启用
        rotateInterval: process.env.LOG_ROTATE_INTERVAL || '1d',
        rotateSize: parseInt(process.env.LOG_ROTATE_SIZE, 10) || 10485760, // 10MB
    },

    // 认证与账户配置
    auth: {
        privateKeyFile: process.env.PRIVATE_KEY_FILE || './private_keys.txt',
    },

    // 以太坊配置
    ethereum: {
        // 使用BlastAPI提供的Sepolia测试网节点
        rpcUrl: process.env.ETH_RPC_URL || 'https://eth-sepolia.public.blastapi.io/',
        chainId: parseInt(process.env.ETH_CHAIN_ID, 10) || 11155111, // Sepolia的chainId
        gasLimit: parseInt(process.env.GAS_LIMIT, 10) || 300000,
        gasPrice: process.env.GAS_PRICE || null, // 如果null则使用网络估算
        maxFeePerGas: process.env.MAX_FEE_PER_GAS || null, // 用于EIP-1559交易
        maxPriorityFeePerGas: process.env.MAX_PRIORITY_FEE_PER_GAS || null, // 用于EIP-1559交易
        confirmations: parseInt(process.env.CONFIRMATIONS, 10) || 1,
        // 交易超时(ms)
        txTimeout: parseInt(process.env.TX_TIMEOUT, 10) || 60000,
    },

    // 并发配置
    concurrency: {
        maxWorkers: parseInt(process.env.MAX_WORKERS, 10) || 5,
        maxTasksPerWorker: parseInt(process.env.MAX_TASKS_PER_WORKER, 10) || 10,
        accountCooldown: parseInt(process.env.ACCOUNT_COOLDOWN, 10) || 300000, // 默认5分钟
        workerTimeout: parseInt(process.env.WORKER_TIMEOUT, 10) || 3600000, // 默认1小时
        taskSlots: parseInt(process.env.TASK_SLOTS, 10) || 20, // 任务槽位数
    },

    // 网络请求配置
    network: {
        timeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000,
        maxRetries: parseInt(process.env.REQUEST_MAX_RETRIES, 10) || 3,
        retryDelay: parseInt(process.env.REQUEST_RETRY_DELAY, 10) || 2000,
        rateLimit: parseInt(process.env.REQUEST_RATE_LIMIT, 10) || 20,
        // 代理配置
        useProxy: process.env.USE_PROXY === 'true',
        useDynamicProxy: process.env.USE_DYNAMIC_PROXY === 'true',
        proxyHost: process.env.PROXY_HOST,
        proxyPort: process.env.PROXY_PORT,
        proxyUsername: process.env.PROXY_USERNAME,
        proxyPassword: process.env.PROXY_PASSWORD
    },
    
    // API配置
    api: {
        baseUrl: process.env.API_BASE_URL || 'https://api.example.com', // 通用API基础URL
        endpoints: {
            sign: '/sign',
            createEvent: '/create-event',
            // FractionAI相关接口
            getProfile: '/user/profile',
            getAgents: '/agents',
            createMatch: '/match/create',
            joinMatch: '/match/join',
            checkMatchStatus: '/match/status',
            getMatchResult: '/match/result',
            claimRewards: '/rewards/claim'
        }
    },
    
    // 安全配置
    security: {
        ja3Fingerprints: [
            // Chrome指纹
            "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
            // Firefox指纹
            "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0",
            // Safari指纹
            "771,49196-49195-49188-49187-49162-49161-52393-49200-49199-49192-49191-49172-49171-52392,0-13-5-11-43-10-27-51-35-16-17513,29-23-24,0",
            // Edge指纹
            "772,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-51-45-43-27,29-23-24-25,0"
        ],
        userAgents: [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15"
        ]
    },
    
    // 任务配置
    tasks: {
        // 是否在任务失败时停止执行后续任务
        stopOnFailure: process.env.STOP_ON_FAILURE === 'true',
        // 任务间延迟(ms)，可以是数字或设为true使用随机延迟
        delayBetweenTasks: process.env.DELAY_BETWEEN_TASKS === 'true' ? true : 
                         parseInt(process.env.DELAY_BETWEEN_TASKS, 10) || 2000,
        // 任务重试
        maxRetries: parseInt(process.env.TASK_MAX_RETRIES, 10) || 3,
        initialRetryDelay: parseInt(process.env.TASK_RETRY_DELAY, 10) || 2000,
        // 任务执行顺序
        sequence: process.env.TASK_SEQUENCE ? 
                 process.env.TASK_SEQUENCE.split(',') : 
                 ['sign', 'createEvent', 'fractionAI:getProfile', 'fractionAI:getAgents']
    },
    
    // 错误处理配置
    errorHandling: {
        maxConsecutiveErrors: parseInt(process.env.MAX_CONSECUTIVE_ERRORS, 10) || 5,
        cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD, 10) || 300000  // 默认5分钟
    },
    
    // FractionAI配置
    fractionAI: {
        baseUrl: process.env.FRACTION_API_URL || 'https://dapp.fractionai.xyz/api', // FractionAI API基础URL
        api3BaseUrl: process.env.FRACTION_API3_URL || 'https://dapp-backend-4x.fractionai.xyz/api3', // FractionAI API3基础URL
        matchMode: process.env.MATCH_MODE || 'auto',  // 对战模式: auto或manual
        maxGames: parseInt(process.env.MAX_GAMES, 10) || 5,  // 最大游戏次数
        entryFee: parseInt(process.env.ENTRY_FEE) || 0.001  // 入场费
    },
    
    // 验证码配置
    captcha: {
        service: process.env.CAPTCHA_SERVICE || null, // 支持 '2captcha', 'anticaptcha', 'capmonster'
        apiKey: process.env.CAPTCHA_API_KEY || null,
        siteKeys: {
            // 预设的各网站验证码密钥
            hcaptcha: {
                'dapp.fractionai.xyz': process.env.HCAPTCHA_SITE_KEY || 'site-key-placeholder',
            },
            recaptcha: {
                'dapp.fractionai.xyz': process.env.RECAPTCHA_SITE_KEY || 'site-key-placeholder',
            }
        }
    }
};

// 环境特定配置覆盖
const environment = process.env.NODE_ENV || 'development';
if (environment === 'production') {
    // 生产环境配置覆盖
    config.logging.level = 'info';
} else if (environment === 'test') {
    // 测试环境配置覆盖
    config.logging.level = 'debug';
    config.errorHandling.cooldownPeriod = 10000; // 测试环境使用更短的冷却期
}

// 导出配置
module.exports = config; 
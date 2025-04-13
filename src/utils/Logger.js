/**
 * 日志管理器
 * 使用Winston实现高性能日志系统，支持日志轮转和多级别日志
 */
const winston = require('winston');
const { format } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 创建日志目录 - 如果不存在则创建
const logDir = path.resolve(config.logging.folderPath);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 定义日志级别
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    verbose: 4
};

// 定义级别颜色
const LEVEL_COLORS = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    verbose: 'gray'
};

// 添加自定义颜色
winston.addColors(LEVEL_COLORS);

// 自定义格式
const customFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    format.splat(),
    format.printf(({ level, message, timestamp, label, stack }) => {
        const moduleLabel = label ? `[${label}]` : '';
        if (stack) {
            return `[${timestamp}] [${level.toUpperCase()}] ${moduleLabel} ${message}\n${stack}`;
        }
        return `[${timestamp}] [${level.toUpperCase()}] ${moduleLabel} ${message}`;
    })
);

// 控制台格式 - 带颜色
const consoleFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.colorize(),
    format.printf(({ level, message, timestamp, label, stack }) => {
        const moduleLabel = label ? `[${label}]` : '';
        if (stack) {
            return `[${timestamp}] [${level}] ${moduleLabel} ${message}\n${stack}`;
        }
        return `[${timestamp}] [${level}] ${moduleLabel} ${message}`;
    })
);

// 单例记录器实例缓存
const loggerInstances = new Map();

// 缓存配置以避免重复读取
let cachedConfig = null;

/**
 * 获取日志配置
 * @returns {Object} 日志配置对象
 */
function getLogConfig() {
    if (cachedConfig) return cachedConfig;
    
    cachedConfig = {
        level: process.env.LOG_LEVEL || config.logging.level || 'info',
        consoleOutput: config.logging.consoleOutput !== false,
        fileOutput: config.logging.fileOutput !== false,
        directory: config.logging.folderPath,
        filePrefix: 'app',
        rotateSize: config.logging.rotateSize || '10m',
        maxFiles: config.logging.maxLogFiles || '10'
    };
    
    return cachedConfig;
}

class Logger {
    /**
     * 构造函数
     * @param {string} name 日志名称
     */
    constructor(name) {
        this.name = name;
        
        // 如果实例已存在，直接返回缓存的实例
        const cacheKey = `logger_${name}`;
        if (loggerInstances.has(cacheKey)) {
            return loggerInstances.get(cacheKey);
        }
        
        // 获取日志配置
        const logConfig = getLogConfig();
        
        // 默认只启用控制台和文件日志，可配置
        const transports = [];
        
        // 添加控制台日志
        if (logConfig.consoleOutput) {
            transports.push(
                new winston.transports.Console({
                    level: logConfig.level,
                    format: consoleFormat
                })
            );
        }
        
        // 如果配置了文件日志，则添加文件日志传输
        if (logConfig.fileOutput) {
            // 按日期轮转的常规日志文件 - 仅记录info级别及以上
            transports.push(new DailyRotateFile({
                level: 'info', // 只记录info及以上级别到主日志
                dirname: logConfig.directory,
                filename: `${logConfig.filePrefix}-%DATE%.log`,
                datePattern: 'YYYY-MM-DD',
                maxSize: logConfig.rotateSize,
                maxFiles: logConfig.maxFiles,
                format: customFormat,
                zippedArchive: false
            }));
            
            // 错误日志单独存储
            transports.push(new DailyRotateFile({
                level: 'error',
                dirname: logConfig.directory,
                filename: `${logConfig.filePrefix}-error-%DATE%.log`,
                datePattern: 'YYYY-MM-DD',
                maxSize: logConfig.rotateSize,
                maxFiles: logConfig.maxFiles,
                format: customFormat,
                zippedArchive: false
            }));
            
            // 调试日志单独存储 - 仅在debug模式下记录
            if (logConfig.level === 'debug' || logConfig.level === 'verbose') {
                transports.push(new DailyRotateFile({
                    level: 'debug',
                    dirname: logConfig.directory,
                    filename: `${logConfig.filePrefix}-debug-%DATE%.log`,
                    datePattern: 'YYYY-MM-DD',
                    maxSize: logConfig.rotateSize,
                    maxFiles: Math.min(5, logConfig.maxFiles), // 限制调试日志文件数量
                    format: customFormat,
                    zippedArchive: false
                }));
            }
        }
        
        // 创建日志实例
        this.logger = winston.createLogger({
            levels: LOG_LEVELS,
            level: logConfig.level,
            defaultMeta: { label: name },
            transports: transports,
            exitOnError: false  // 不因日志错误退出程序
        });
        
        // 缓存实例
        loggerInstances.set(cacheKey, this);
    }

    /**
     * 记录错误日志
     * @param {string} message 日志内容
     * @param {Error} [error] 错误对象
     */
    error(message, error) {
        if (error instanceof Error) {
            this.logger.error(`${message}: ${error.message}`, { stack: error.stack });
        } else if (error !== undefined) {
            this.logger.error(`${message}: ${JSON.stringify(error)}`);
        } else {
            this.logger.error(message);
        }
    }

    /**
     * 记录警告日志
     * @param {string} message 日志内容
     */
    warn(message) {
        this.logger.warn(message);
    }

    /**
     * 记录信息日志
     * @param {string} message 日志内容
     */
    info(message) {
        this.logger.info(message);
    }

    /**
     * 记录调试日志
     * @param {string} message 日志内容
     */
    debug(message) {
        this.logger.debug(message);
    }
    
    /**
     * 记录详细日志
     * @param {string} message 日志内容
     */
    verbose(message) {
        this.logger.verbose(message);
    }
    
    /**
     * 创建一个子日志记录器
     * @param {string} subName 子模块名称
     * @returns {Logger} 子日志记录器实例
     */
    child(subName) {
        return new Logger(`${this.name}:${subName}`);
    }
    
    /**
     * 清除日志实例缓存
     * 通常在测试环境中使用
     */
    static clearInstances() {
        loggerInstances.clear();
        cachedConfig = null;
    }
}

module.exports = Logger; 
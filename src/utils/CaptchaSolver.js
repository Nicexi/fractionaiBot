/**
 * 多服务验证码解决器
 * 支持2captcha验证码服务
 */
const { Solver } = require('@2captcha/captcha-solver');
const Logger = require('./Logger');
const delay = require('delay');

// 验证码类型常量
const CAPTCHA_TYPES = {
    IMAGE: 'image',
    RECAPTCHA_V2: 'recaptcha_v2',
    RECAPTCHA_V3: 'recaptcha_v3',
    HCAPTCHA: 'hcaptcha',
    FUNCAPTCHA: 'funcaptcha',
    GEETEST: 'geetest',
    AMAZON_WAF: 'amazon_waf',
    TURNSTILE: 'turnstile'
};

// 支持的验证码服务
const SUPPORTED_SERVICES = ['2captcha', 'anticaptcha'];

class CaptchaSolver {
    /**
     * 构造函数
     * @param {string} service 验证码服务名称，目前支持'2captcha'
     * @param {string} apiKey API密钥
     * @param {Object} [options] 附加选项
     */
    constructor(service, apiKey, options = {}) {
        this.service = service?.toLowerCase() || '2captcha';
        this.apiKey = apiKey;
        this.options = {
            pollingInterval: 5000, // 轮询间隔(毫秒)
            timeout: 180000,       // 超时时间(毫秒)
            debug: false,          // 是否开启调试模式
            maxRetries: 3,          // 最大重试次数
            retryDelay: 5000,       // 重试间隔(毫秒)
            ...options
        };

        // 验证服务类型
        if (!SUPPORTED_SERVICES.includes(this.service)) {
            throw new Error(`不支持的验证码服务: ${this.service}，目前支持: ${SUPPORTED_SERVICES.join(', ')}`);
        }

        this.logger = new Logger('CaptchaSolver');
        this.lastTaskId = null;
        this.tasks = new Map(); // 存储任务ID和创建时间的映射
        
        // 初始化验证码解决器
        this._initSolver();
    }

    /**
     * 初始化验证码解决器
     * @private
     */
    _initSolver() {
        try {
            // 验证API密钥
            if (!this.apiKey || this.apiKey.length < 5) {
                this.logger.error('API密钥无效或太短');
                throw new Error(`无效的${this.service}API密钥`);
            }
            
            // 记录API密钥的前4位，帮助识别使用的是哪个密钥
            this.logger.debug(`使用API密钥(前4位): ${this.apiKey.substring(0, 4)}...`);
            
            // 根据不同服务初始化
            if (this.service === '2captcha') {
                const solverOptions = {
                    timeout: Math.floor(this.options.timeout / 1000), // 转换为秒
                    polling: Math.floor(this.options.pollingInterval / 1000), // 转换为秒
                    defaultTimeout: Math.floor(this.options.timeout / 1000), // 转换为秒
                    debug: Boolean(process.env.NODE_DEBUG) || this.options.debug, // 使用环境变量或options控制调试输出
                    apiKey: this.apiKey // 确保明确设置apiKey
                };
                
                this.logger.debug(`${this.service}解决器选项: ${JSON.stringify(solverOptions, (k, v) => k === 'apiKey' ? '***' : v)}`);
                this.solver = new Solver(this.apiKey, solverOptions);
                
                this.logger.info(`已初始化验证码解决服务: ${this.service}`);
                
                // 检查余额
                this._checkBalance();
            } else if (this.service === 'anticaptcha') {
                // 如果后续支持AntiCaptcha，在这里初始化
                throw new Error('AntiCaptcha服务尚未实现');
            }
        } catch (error) {
            this.logger.error(`初始化验证码服务失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查账户余额
     * @private
     */
    async _checkBalance() {
        try {
            const balance = await this.getBalance();
            if (balance < 0.1) {
                this.logger.warn(`验证码服务账户余额不足: ${balance}$`);
            } else {
                this.logger.info(`验证码服务账户余额: ${balance}$`);
            }
        } catch (err) {
            this.logger.warn(`获取验证码服务余额失败: ${err.message}`);
        }
    }

    /**
     * 清理过期任务
     * @private
     */
    _cleanupTasks() {
        const now = Date.now();
        const expiry = this.options.timeout * 2; // 两倍超时时间
        
        for (const [taskId, createdAt] of this.tasks.entries()) {
            if (now - createdAt > expiry) {
                this.tasks.delete(taskId);
                this.logger.debug(`清理过期任务: ${taskId}`);
            }
        }
    }

    /**
     * 执行验证码解决任务，带重试机制
     * @param {Function} solverFn 解决器函数
     * @param {string} captchaType 验证码类型
     * @param {Object} params 参数
     * @returns {Promise<string>} 验证码令牌
     * @private
     */
    async _executeWithRetry(solverFn, captchaType, params) {
        let retries = 0;
        let lastError = null;
        
        while (retries <= this.options.maxRetries) {
            try {
                this.logger.info(`开始解决${captchaType}验证码${retries > 0 ? ` (重试 ${retries}/${this.options.maxRetries})` : ''}`);
                
                const result = await solverFn(params);
                
                this.lastTaskId = result.id;
                this.tasks.set(result.id, Date.now());
                
                // 清理过期任务
                this._cleanupTasks();
                
                this.logger.info(`验证码解决成功: ${captchaType}`);
                return result.data;
            } catch (error) {
                lastError = error;
                
                const shouldRetry = error.message && (
                    error.message.includes('timeout') ||
                    error.message.includes('TIMEOUT') ||
                    error.message.includes('network') ||
                    error.message.includes('NETWORK') ||
                    error.message.includes('queue')
                );
                
                if (shouldRetry && retries < this.options.maxRetries) {
                    retries++;
                    const retryDelay = this.options.retryDelay * Math.pow(1.5, retries - 1);
                    
                    this.logger.warn(`验证码解决失败，将在 ${retryDelay}ms 后重试: ${error.message}`);
                    await delay(retryDelay);
                } else {
                    break;
                }
            }
        }
        
        this.logger.error(`解决${captchaType}验证码失败，已达最大重试次数: ${lastError.message}`);
        throw lastError;
    }

    /**
     * 解决reCAPTCHA v2
     * @param {string} siteKey 站点密钥
     * @param {string} pageUrl 页面URL
     * @param {boolean} [invisible=false] 是否是隐形reCAPTCHA
     * @returns {Promise<string>} 验证码令牌
     */
    async solveRecaptchaV2(siteKey, pageUrl, invisible = false) {
        return this._executeWithRetry(
            (params) => this.solver.recaptcha(params.siteKey, params.pageUrl, {
                invisible: params.invisible,
                enterprise: false,
                version: 'v2'
            }),
            CAPTCHA_TYPES.RECAPTCHA_V2,
            { siteKey, pageUrl, invisible }
        );
    }
    
    /**
     * 解决reCAPTCHA v3
     * @param {string} siteKey 站点密钥
     * @param {string} pageUrl 页面URL
     * @param {string} action 操作名称
     * @param {number} [minScore=0.7] 最小分数
     * @returns {Promise<string>} 验证码令牌
     */
    async solveRecaptchaV3(siteKey, pageUrl, action = 'verify', minScore = 0.7) {
        return this._executeWithRetry(
            (params) => this.solver.recaptcha(params.siteKey, params.pageUrl, {
                version: 'v3',
                action: params.action,
                minScore: params.minScore
            }),
            CAPTCHA_TYPES.RECAPTCHA_V3,
            { siteKey, pageUrl, action, minScore }
        );
    }
    
    /**
     * 解决hCaptcha
     * @param {string} siteKey 站点密钥
     * @param {string} pageUrl 页面URL
     * @returns {Promise<string>} 验证码令牌
     */
    async solveHCaptcha(siteKey, pageUrl) {
        return this._executeWithRetry(
            (params) => this.solver.hcaptcha(params.siteKey, params.pageUrl),
            CAPTCHA_TYPES.HCAPTCHA,
            { siteKey, pageUrl }
        );
    }
    
    /**
     * 解决FunCaptcha (Arkose Labs)
     * @param {string} publicKey 公钥
     * @param {string} pageUrl 页面URL
     * @param {Object} [additional] 附加参数
     * @returns {Promise<string>} 验证码令牌
     */
    async solveFunCaptcha(publicKey, pageUrl, additional = {}) {
        return this._executeWithRetry(
            (params) => this.solver.funcaptcha(params.publicKey, params.pageUrl, params.additional),
            CAPTCHA_TYPES.FUNCAPTCHA,
            { publicKey, pageUrl, additional }
        );
    }
    
    /**
     * 解决图片验证码
     * @param {string} base64Image Base64编码的图片
     * @param {Object} [options] 附加选项
     * @returns {Promise<string>} 验证码文本
     */
    async solveImageCaptcha(base64Image, options = {}) {
        return this._executeWithRetry(
            async (params) => {
                const result = await this.solver.imageCaptcha({
                    body: params.base64,
                    ...params.options
                });
                return result;
            },
            CAPTCHA_TYPES.IMAGE,
            {
                base64: base64Image,
                options
            }
        );
    }
    
    /**
     * 获取账户余额
     * @returns {Promise<number>} 账户余额
     */
    async getBalance() {
        try {
            const balance = await this.solver.balance();
            return Number(balance);
        } catch (error) {
            this.logger.error(`获取账户余额失败: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 举报不正确的验证码
     * @param {string} [taskId] 任务ID，不提供则使用最后一个任务ID
     * @returns {Promise<boolean>} 是否举报成功
     */
    async reportIncorrect(taskId = null) {
        const id = taskId || this.lastTaskId;
        
        if (!id) {
            this.logger.warn('没有可举报的验证码任务');
            return false;
        }
        
        try {
            await this.solver.report(id);
            this.logger.info(`已成功举报不正确的验证码，任务ID: ${id}`);
            return true;
        } catch (error) {
            this.logger.error(`举报验证码失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取解决器统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        return {
            service: this.service,
            activeTasks: this.tasks.size,
            lastTaskId: this.lastTaskId,
            options: {
                ...this.options,
                apiKey: this.apiKey ? `${this.apiKey.substring(0, 4)}...` : null
            }
        };
    }
}

// 导出验证码类型常量
CaptchaSolver.TYPES = CAPTCHA_TYPES;
CaptchaSolver.SUPPORTED_SERVICES = SUPPORTED_SERVICES;

module.exports = CaptchaSolver; 
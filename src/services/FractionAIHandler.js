/**
 * FractionAI平台处理器
 * 负责处理FractionAI平台相关的任务
 */
const { ethers } = require('ethers');
const delay = require('delay');
const axios = require('axios');
const { Solver } = require('@2captcha/captcha-solver');
const CaptchaSolver = require('../utils/CaptchaSolver');
const config = require('../config');

class FractionAIHandler {
    /**
     * 构造函数
     * @param {Object} client TLS客户端
     * @param {Object} ethSigner 以太坊签名工具
     * @param {Object} logger 日志记录工具
     */
    constructor(client, ethSigner, logger) {
        this.client = client;
        this.ethSigner = ethSigner;
        this.logger = logger;
        this.address = ethSigner.address;
        this.userProfile = null;
        this.agents = [];
        this.selectedAgent = null;
        this.matchId = null;
        this.matchResult = null;
        this.apiBaseUrl = config.fractionAI.baseUrl;
        this.api3BaseUrl = config.fractionAI.api3BaseUrl;
        this.accessToken = null;
        this.refreshToken = null;
        this.userId = null;
        
        // 初始化验证码解决器
        if (config.captcha.service && config.captcha.apiKey) {
            try {
                this.captchaSolver = new CaptchaSolver(
                    config.captcha.service,
                    config.captcha.apiKey,
                    {
                        pollingInterval: 5000,
                        timeout: 180000,
                        debug: config.logging.level === 'debug'
                    }
                );
                this.logger.info(`已初始化验证码服务: ${config.captcha.service}`);
            } catch (error) {
                this.logger.error(`初始化验证码服务失败: ${error.message}`);
                this.captchaSolver = null;
            }
        } else {
            this.captchaSolver = null;
            this.logger.warn('未配置验证码服务，验证码解决将使用模拟方式');
        }
    }

    /**
     * 生成随机字符串
     * @param {number} length 字符串长度
     * @returns {string} 随机字符串
     */
    generateRandomString(length = 16) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * 创建签名
     * @param {string} message 待签名的消息
     * @returns {Promise<string>} 签名结果
     */
    async createSignature(message) {
        try {
            if (!this.ethSigner) {
                throw new Error('未找到以太坊签名器');
            }
            
            this.logger.info('使用以太坊钱包创建签名...');
            
            // 使用ethSigner签名消息
            const signature = await this.ethSigner.signMessage(message);
            
            if (!signature) {
                throw new Error('签名失败，返回空结果');
            }
            
            this.logger.info(`签名成功: ${signature}...`);
            return signature;
        } catch (error) {
            this.logger.error(`创建签名失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 解析验证码
     * @param {string} url 验证码图片URL
     * @returns {Promise<string>} 验证码文本
     */
    async solveCaptcha(url) {
        try {
            this.logger.info(`开始处理验证码: ${url}`);
            
            // 检查URL
            if (!url || typeof url !== 'string') {
                throw new Error('无效的验证码URL');
            }

            // 使用axios从URL获取图像
            const axios = require('axios');
            
            let config = {
                method: 'get',
                maxBodyLength: Infinity,
                url: url,
                responseType: 'arraybuffer',
                headers: { }
            };
            
            // 从URL获取图像
            const response = await axios.request(config);
            
            // 检查响应
            if (!response.data) {
                throw new Error('获取验证码图片失败，响应为空');
            }
            
            // 检查内容类型
            const contentType = response.headers['content-type'] || '';
            if (!contentType.includes('image/')) {
                throw new Error(`验证码URL返回的不是图片: ${contentType}`);
            }

            // 将图像转换为base64
            const imageBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
            const base64Image = imageBuffer.toString('base64');
            
            // 使用验证码服务解决
            const solver = this.getCaptchaSolver();
            this.logger.info('开始识别验证码...');
            
            const result = await solver.solveImageCaptcha(base64Image);
            
            // 检查结果
            if (!result) {
                throw new Error('验证码识别返回空结果');
            }
            
            // 判断结果格式并提取验证码文本
            let captchaText;
            
            if (typeof result === 'string') {
                // 直接返回文本
                captchaText = result;
            } else if (result.solution) {
                // 2captcha格式
                captchaText = result.solution;
            } else if (result.result) {
                // 另一种格式
                captchaText = result.result;
            } else if (result.data) {
                // 包装在data字段中
                captchaText = typeof result.data === 'string' ? result.data : (result.data.text || result.data.solution || result.data.result);
            } else {
                // 尝试JSON字符串化看结果
                this.logger.error(`未能识别验证码结果格式: ${JSON.stringify(result)}`);
                throw new Error('验证码结果格式不正确');
            }
            
            if (!captchaText) {
                throw new Error(`验证码识别失败，无法提取文本: ${JSON.stringify(result)}`);
            }
            
            this.logger.info(`验证码识别成功: ${captchaText}`);
            return captchaText;
        } catch (error) {
            this.logger.error(`验证码解决失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取用户资料
     * @returns {Promise<Object>} 用户资料
     */
    async getProfile() {
        try {
            const nonce = Date.now();
            const message = {
                action: 'get_profile',
                address: this.address,
                nonce: nonce
            };

            const signature = await this.createSignature(message);

            const response = await this.client.get(
                `${this.apiBaseUrl}${config.api.endpoints.getProfile}`,
                {
                    headers: {
                        'x-address': this.address,
                        'x-signature': signature,
                        'x-nonce': nonce
                    }
                }
            );

            this.userProfile = response.data;
            this.logger.info(`获取用户资料成功: ${this.userProfile.username || 'Unknown'}`);

            return {
                success: true,
                data: this.userProfile,
                address: this.address
            };
        } catch (error) {
            this.logger.error('获取用户资料失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 获取AI代理列表
     * @returns {Promise<Object>} AI代理列表结果
     */
    async getAgents() {
        try {
            const response = await this.client.get(
                `${this.apiBaseUrl}${config.api.endpoints.getAgents}`
            );

            this.agents = response.data.agents || [];
            
            if (this.agents.length > 0) {
                // 默认选择第一个代理
                this.selectedAgent = this.agents[0];
                this.logger.info(`获取代理列表成功，总数: ${this.agents.length}, 默认选择: ${this.selectedAgent.name}`);
            } else {
                this.logger.warn('获取代理列表成功，但没有可用的代理');
            }

            return {
                success: true,
                data: {
                    agents: this.agents,
                    selectedAgent: this.selectedAgent
                },
                address: this.address
            };
        } catch (error) {
            this.logger.error('获取AI代理列表失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 创建对战
     * @returns {Promise<Object>} 创建对战结果
     */
    async createMatch() {
        try {
            if (!this.selectedAgent) {
                throw new Error('未选择AI代理，请先执行getAgents任务');
            }

            const entryFee = config.fractionAI.entryFee || '0.001';
            
            const matchData = {
                agentId: this.selectedAgent.id,
                entryFee: ethers.utils.parseEther(entryFee),
                timestamp: Date.now()
            };

            const signature = await this.createSignature(matchData);
            
            // 检测页面上可能存在的验证码类型和站点密钥
            let captchaSiteKey = null;
            let captchaType = null;
            
            // 实际应用中可能需要从网站页面中提取验证码信息
            // 这里使用预设值模拟
            if (config.captcha.siteKeys && config.captcha.siteKeys.hcaptcha) {
                // FractionAI可能使用的是hCaptcha
                captchaSiteKey = config.captcha.siteKeys.hcaptcha['dapp.fractionai.xyz'];
                captchaType = 'hcaptcha';            
            }
            
            // 解决验证码
            const captchaSolution = await this.solveCaptcha(
                captchaSiteKey,
                this.apiBaseUrl,
                captchaType
            );
            
            const response = await this.client.post(
                `${this.apiBaseUrl}${config.api.endpoints.createMatch}`,
                {
                    ...matchData,
                    signature: signature,
                    captchaToken: captchaSolution
                }
            );

            this.matchId = response.data.matchId;
            this.logger.info(`创建对战成功，比赛ID: ${this.matchId}`);

            return {
                success: true,
                data: response.data,
                matchId: this.matchId,
                address: this.address
            };
        } catch (error) {
            this.logger.error('创建对战失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 加入对战
     * @returns {Promise<Object>} 加入对战结果
     */
    async joinMatch() {
        try {
            if (!this.matchId) {
                throw new Error('未找到有效的比赛ID，请先创建对战');
            }

            const joinData = {
                matchId: this.matchId,
                timestamp: Date.now()
            };

            const signature = await this.createSignature(joinData);
            
            const response = await this.client.post(
                `${this.apiBaseUrl}${config.api.endpoints.joinMatch}`,
                {
                    ...joinData,
                    signature: signature
                }
            );

            this.logger.info(`加入对战成功，比赛ID: ${this.matchId}`);

            return {
                success: true,
                data: response.data,
                matchId: this.matchId,
                address: this.address
            };
        } catch (error) {
            this.logger.error('加入对战失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 检查对战状态
     * @returns {Promise<Object>} 对战状态结果
     */
    async checkMatchStatus() {
        try {
            if (!this.matchId) {
                throw new Error('未找到有效的比赛ID，请先创建对战');
            }

            const statusData = {
                matchId: this.matchId,
                timestamp: Date.now()
            };

            const signature = await this.createSignature(statusData);
            
            const response = await this.client.post(
                `${this.apiBaseUrl}${config.api.endpoints.checkMatchStatus}`,
                {
                    ...statusData,
                    signature: signature
                }
            );

            const status = response.data.status;
            this.logger.info(`检查对战状态成功，比赛ID: ${this.matchId}, 状态: ${status}`);

            // 如果比赛已完成，可以获取结果
            if (status === 'completed') {
                this.logger.info('对战已完成，可以获取结果');
            } else if (status === 'in_progress') {
                this.logger.info('对战正在进行中，需要继续等待');
            }

            return {
                success: true,
                data: response.data,
                matchId: this.matchId,
                status: status,
                address: this.address
            };
        } catch (error) {
            this.logger.error('检查对战状态失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 获取对战结果
     * @returns {Promise<Object>} 对战结果
     */
    async getMatchResult() {
        try {
            if (!this.matchId) {
                throw new Error('未找到有效的比赛ID，请先创建对战');
            }

            const resultData = {
                matchId: this.matchId,
                timestamp: Date.now()
            };

            const signature = await this.createSignature(resultData);
            
            const response = await this.client.post(
                `${this.apiBaseUrl}${config.api.endpoints.getMatchResult}`,
                {
                    ...resultData,
                    signature: signature
                }
            );

            this.matchResult = response.data;
            const result = this.matchResult.result || 'unknown';
            const reward = this.matchResult.reward || 0;
            
            this.logger.info(`获取对战结果成功，比赛ID: ${this.matchId}, 结果: ${result}, 奖励: ${reward}`);

            return {
                success: true,
                data: this.matchResult,
                matchId: this.matchId,
                address: this.address
            };
        } catch (error) {
            this.logger.error('获取对战结果失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 领取奖励
     * @returns {Promise<Object>} 领取奖励结果
     */
    async claimRewards() {
        try {
            if (!this.matchResult || !this.matchResult.reward || this.matchResult.reward <= 0) {
                throw new Error('无可领取的奖励，请先获取比赛结果');
            }

            const claimData = {
                matchId: this.matchId,
                reward: this.matchResult.reward,
                timestamp: Date.now()
            };

            const signature = await this.createSignature(claimData);
            
            const response = await this.client.post(
                `${this.apiBaseUrl}${config.api.endpoints.claimRewards}`,
                {
                    ...claimData,
                    signature: signature
                }
            );

            this.logger.info(`领取奖励成功，比赛ID: ${this.matchId}, 奖励: ${this.matchResult.reward}`);

            return {
                success: true,
                data: response.data,
                matchId: this.matchId,
                reward: this.matchResult.reward,
                address: this.address
            };
        } catch (error) {
            this.logger.error('领取奖励失败', error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 验证用户并获取访问令牌
     * @returns {Promise<Object>} 验证结果
     */
    async verify() {
        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;

        while (retryCount <= maxRetries) {
            try {
                if (!this.ethSigner) {
                    this.logger.error('未找到以太坊签名器');
                    throw new Error('未找到以太坊签名器');
                }
                // 获取随机字符串作为随机数
                const nonce = await this.getNonce();
                
                if (!nonce) {
                    throw new Error('获取nonce失败');
                }
                
                const timestamp = new Date().toISOString();
                const message = `fractionai.xyz wants you to sign in with your Ethereum account:\n${this.address}\n\nSign in with your wallet to Fraction AI.\n\nURI: https://fractionai.xyz\nVersion: 1\nChain ID: 11155111\nNonce: ${nonce.nonce}\nIssued At: ${timestamp}`;
                // 构建要签名的消息
                
                this.logger.info(`准备为地址 ${this.address} 进行验证签名`);
                
                // 使用ethers签名器签名消息
                const signature = await this.createSignature(message);
                
                if (!signature) {
                    throw new Error('签名失败');
                }
                // 构造请求体
                const requestBody = {
                    'message':message,
                    'signature':signature,
                    'referralCode':null
                };
                
                // 设置请求头
                const headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Allowed-State': 'na'
                };
                
                // 发送POST请求到验证端点
                const response = await this.client.post(
                    `${this.api3BaseUrl}/auth/verify`,
                    requestBody,
                    headers
                );
                this.logger.debug(`验证响应: ${JSON.stringify(response.data)}`);
                // 检查响应
                if (!response.data || !response.data.accessToken) {
                    this.logger.error(`验证失败: ${JSON.stringify(response.data)}`);
                    throw new Error('验证响应中未找到访问令牌');
                }
                
                // 保存访问令牌和用户ID
                this.accessToken = response.data.accessToken;
                this.userId = response.data.user.id;
                
                this.logger.info(`验证成功，获取到访问令牌，用户ID: ${this.userId}`);
                
                return {
                    success: true,
                    accessToken: this.accessToken,
                    userId: this.userId,
                    address: this.address
                };
            } catch (error) {
                lastError = error;
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    // 计算指数退避的延迟时间
                    const delay = 2000 * Math.pow(2, retryCount - 1);
                    this.logger.warn(`验证失败，尝试第 ${retryCount} 次重试，将等待 ${delay}ms: ${error.message}`);
                    
                    // 等待一段时间后再重试
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // 达到最大重试次数
                    this.logger.error(`验证失败，已达到最大重试次数(${maxRetries}): ${error.message}`);
                    return {
                        success: false,
                        error: error.message,
                        address: this.address,
                        retries: retryCount - 1
                    };
                }
            }
        }
    }

    /**
     * 获取用户智能代理列表
     * @returns {Promise<Object>} 包含智能代理列表的结果对象
     */
    async getUserAgents() {
        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;

        while (retryCount <= maxRetries) {
            try {
                if (!this.accessToken || !this.userId) {
                    this.logger.error('未获取到访问令牌或用户ID，请先执行verify任务');
                    return {
                        success: false,
                        error: '未获取到访问令牌或用户ID，请先执行verify任务',
                        address: this.address
                    };
                }
                
                this.logger.info('准备获取用户智能代理列表, 用户ID: ' + this.userId);
                
                // 直接使用正确的API端点
                const url = `${this.api3BaseUrl}/agents/user/${this.userId}`;
                this.logger.debug(`使用端点: ${url}`);
                this.logger.debug(`完整请求URL: ${url}`);
                
                // 使用对象形式的headers
                const headers = {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/json',
                    'Allowed-State': 'na'
                };
                
                this.logger.debug(`请求headers: ${JSON.stringify(headers)}`);
                
                const response = await this.client.get(
                    url,
                    headers
                );
                
                this.logger.debug(`API响应状态: ${response.status}`);
                this.logger.debug(`API响应数据: ${JSON.stringify(response.data)}`);
                
                let agentsData = [];
                
                if (response.data) {
                    if (Array.isArray(response.data)) {
                        agentsData = response.data;
                    } else if (response.data.agents && Array.isArray(response.data.agents)) {
                        agentsData = response.data.agents;
                    } else if (response.data.data && Array.isArray(response.data.data)) {
                        agentsData = response.data.data;
                    } else {
                        throw new Error('API响应格式不符合预期');
                    }
                } else {
                    throw new Error('API响应为空');
                }
                
                this.logger.info(`成功获取${agentsData.length}个智能代理`);
                
                if (agentsData.length > 0) {
                    // 选择第一个代理
                    this.selectedAgent = agentsData[0];
                    
                    // 确保代理有name和id属性
                    const agentName = this.selectedAgent.name || 
                                     this.selectedAgent.agentName || 
                                     'Agent-' + this.selectedAgent.id;
                                     
                    const agentId = this.selectedAgent.id || 
                                   this.selectedAgent.agentId || 
                                   this.selectedAgent._id;
                    
                    this.logger.info(`选择智能代理: ${agentName} (ID: ${agentId})`);
                    this.logger.debug(`所选代理详细信息: ${JSON.stringify(this.selectedAgent)}`);
                } else {
                    this.logger.warn('用户没有智能代理，需要先创建');
                    this.selectedAgent = null;
                }
                
                return {
                    success: true,
                    agents: agentsData,
                    selectedAgent: this.selectedAgent,
                    address: this.address
                };
            } catch (error) {
                lastError = error;
                retryCount++;
                
                // 记录更详细的错误信息
                this.logger.debug(`错误详情: ${JSON.stringify({
                    message: error.message,
                    stack: error.stack,
                    url: `${this.api3BaseUrl}/agents/user/${this.userId}`,
                    hasAccessToken: !!this.accessToken,
                    hasUserId: !!this.userId,
                    accessTokenLength: this.accessToken ? this.accessToken.length : 0
                })}`);
                
                if (retryCount <= maxRetries) {
                    // 计算指数退避的延迟时间
                    const delay = 2000 * Math.pow(2, retryCount - 1);
                    this.logger.warn(`获取用户智能代理失败，尝试第 ${retryCount} 次重试，将等待 ${delay}ms: ${error.message}`);
                    
                    // 等待一段时间后再重试
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // 检查特定错误类型，尝试重新验证
                    if (error.message.includes('认证') || error.message.includes('auth') || 
                        error.message.includes('token') || error.message.includes('授权')) {
                        this.logger.warn('可能是认证问题，尝试重新验证');
                        
                        try {
                            // 尝试重新验证
                            const verifyResult = await this.verify();
                            if (!verifyResult.success) {
                                throw new Error(`重新验证失败: ${verifyResult.error}`);
                            }
                            this.logger.info('重新验证成功，继续重试');
                        } catch (verifyError) {
                            this.logger.error(`重新验证失败: ${verifyError.message}`);
                        }
                    }
                } else {
                    // 达到最大重试次数
                    this.logger.error(`获取用户智能代理失败，已达到最大重试次数(${maxRetries}): ${lastError.message}`);
                    return {
                        success: false,
                        error: lastError.message,
                        address: this.address,
                        retries: retryCount - 1
                    };
                }
            }
        }
    }

    /**
     * 获取验证码和nonce
     * @returns {Promise<Object>} 包含验证码图片URL和nonce的对象
     */
    async getCaptchaNonce() {
        try {
            // 验证是否已经获取到accessToken
            if (!this.accessToken || !this.userId) {
                this.logger.error('未获取到访问令牌或用户ID，请先执行verify任务');
                throw new Error('未获取到访问令牌或用户ID，请先执行verify任务');
            }
            
            this.logger.info('获取验证码和nonce');
            
            // 使用对象形式的headers
            const headers = {
                'Authorization': `Bearer ${this.accessToken}`,
                'Accept': 'application/json',
                'Allowed-State': 'na'
            };
            
            // 发送请求获取验证码
            const response = await this.client.get(
                `${this.api3BaseUrl}/auth/nonce`,
                headers
            );
            
            this.logger.debug(`验证码API响应: ${JSON.stringify(response.data)}`);
            
            if (!response.data || !response.data.nonce || !response.data.image) {
                throw new Error('获取验证码返回格式不正确');
            }
            
            const { nonce, image } = response.data;
            
            this.logger.info(`获取验证码成功，nonce: ${nonce}`);
            this.logger.debug(`验证码图片URL: ${image}`);
            
            return { nonce, image };
        } catch (error) {
            this.logger.error(`获取验证码失败: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 识别验证码图片
     * @param {string} imageUrl 验证码图片URL
     * @returns {Promise<string>} 识别结果
     */
    async recognizeCaptchaImage(imageUrl) {
        const maxRetries = 3;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                this.logger.info(`开始识别验证码图片 (尝试 ${retryCount + 1}/${maxRetries})`);
                
                // 如果没有配置验证码服务，无法进行识别
                if (!this.captchaSolver) {
                    this.logger.error('未配置验证码服务，无法识别验证码');
                    throw new Error('未配置验证码服务，请配置2captcha服务');
                }
                
                this.logger.debug(`开始下载验证码图片: ${imageUrl}`);
                
                // 修复URL格式问题
                if (imageUrl.startsWith('/')) {
                    imageUrl = `${this.api3BaseUrl}${imageUrl}`;
                    this.logger.debug(`修复相对URL: ${imageUrl}`);
                } else if (!imageUrl.startsWith('http')) {
                    imageUrl = `https://${imageUrl}`;
                    this.logger.debug(`添加协议头: ${imageUrl}`);
                }
                
                // 使用axios下载图片
                const axios = require('axios');
                
                const axiosConfig = {
                    method: 'get',
                    maxBodyLength: Infinity,
                    url: imageUrl,
                    responseType: 'arraybuffer',
                    headers: {
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
                    }
                };
                
                const response = await axios.request(axiosConfig);
                
                // 检查响应状态码
                if (response.status !== 200) {
                    this.logger.error(`验证码图片下载失败，状态码: ${response.status}`);
                    throw new Error(`验证码图片下载失败，状态码: ${response.status}`);
                }
                
                if (!response.data) {
                    this.logger.error('验证码图片数据为空');
                    throw new Error('验证码图片数据为空');
                }
                
                // 将图片转换为base64
                const imageBuffer = Buffer.from(response.data);
                const imageBase64 = imageBuffer.toString('base64');
                
                // 记录调试信息
                this.logger.debug(`验证码图片已下载，大小: ${Math.floor(imageBase64.length / 1024)}KB, 字节数: ${imageBuffer.length}`);
                
                // 检查图片数据是否有效
                if (!imageBase64 || imageBase64.length < 100) {
                    this.logger.error('下载的验证码图片数据无效或太小');
                    throw new Error('验证码图片数据无效');
                }
                
                // 使用验证码解决器识别图片
                this.logger.debug('开始识别验证码图片...');
                const captchaText = await this.captchaSolver.solveImageCaptcha(imageBase64);
                
                this.logger.info(`验证码识别成功: ${captchaText}`);
                return captchaText;
            } catch (error) {
                retryCount++;
                this.logger.error(`识别验证码图片失败 (尝试 ${retryCount}/${maxRetries}): ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    const fatalError = new Error('验证码识别连续失败超过最大重试次数');
                    fatalError.isCaptchaFatalError = true; // 添加标记，便于上层识别
                    throw fatalError;
                }
                
                // 等待一段时间后重试
                await delay(2000 * retryCount);
            }
        }
    }
    
    /**
     * 获取创建代理所需的验证码
     * @returns {Promise<Object>} 验证码结果，包含nonce和captchaText
     */
    async getCaptchaForCreateAgent() {
        try {
            this.logger.info('开始获取图片验证码');
            
            // 获取验证码nonce
            const response = await this.client.get(
                `${this.api3BaseUrl}/auth/nonce`,
                {
                    'Accept': 'application/json',
                }
            );
            
            // 验证响应
            if (!response.data || !response.data.nonce || !response.data.image) {
                this.logger.error(`获取验证码信息失败: ${JSON.stringify(response.data)}`);
                return {
                    success: false,
                    error: '获取验证码信息失败，响应格式不正确'
                };
            }
            
            // 提取nonce和验证码图片URL
            const { nonce, image } = response.data;
            
            // 识别验证码
            try {
                let captchaText = await this.solveCaptcha(image);
                
                this.logger.info(`验证码获取成功，nonce: ${nonce}, 验证码: ${captchaText}`);
                
                return {
                    success: true,
                    nonce,
                    captchaText,
                    image
                };
            } catch (captchaError) {
                this.logger.error(`验证码识别失败: ${captchaError.message}`);
                return {
                    success: false,
                    error: `验证码识别失败: ${captchaError.message}`,
                    nonce
                };
            }
        } catch (error) {
            this.logger.error(`获取验证码流程失败: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 生成随机验证码（模拟）
     * @param {number} length 验证码长度
     * @returns {string} 随机验证码
     */
    generateRandomCaptcha(length = 6) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    /**
     * 创建智能代理
     * @param {Object} options 创建选项
     * @param {string} options.name 代理名称（可选，默认随机生成）
     * @param {string} options.systemPrompt 系统提示（可选，默认使用预设）
     * @param {string} options.avatarLink 头像链接（可选，默认随机选择）
     * @param {string} options.battleType 战斗类型（可选，默认'rap'）
     * @returns {Promise<Object>} 创建结果
     */
    async createAgent(options = {}) {
        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;
        let captchaResult = null;
        
        // 验证是否已经认证
        if (!this.accessToken) {
            this.logger.error('尝试创建代理，但未获取访问令牌，请先验证用户');
            return {
                success: false,
                error: '未获取访问令牌，请先验证用户',
                address: this.address
            };
        }
        
        // 检查是否已有代理，如果有则不创建新代理
        if (this.selectedAgent && this.selectedAgent.id) {
            this.logger.info(`已有选定的代理 ${this.selectedAgent.id}，跳过创建新代理`);
            return {
                success: true,
                agent: this.selectedAgent,
                address: this.address,
                message: '已有代理，跳过创建'
            };
        }

        while (retryCount <= maxRetries) {
            try {
                // 获取必要参数
                const agentName = options.agentName || `${this.generateAgentNamePrefix()}${Math.floor(1000 + Math.random() * 9000)}`;
                
                // 仅在首次尝试或验证码失败时重新获取验证码
                if (!captchaResult || !captchaResult.success) {
                    // 获取captcha
                    captchaResult = await this.getCaptchaForCreateAgent();
                    if (!captchaResult.success) {
                        throw new Error(`获取验证码失败: ${captchaResult.error}`);
                    }
                }
                
                // 构造代理创建请求体
                const requestBody = { 
                    "name": agentName, 
                    "userId": this.userId, 
                    "battleType": "rap",
                    "sessionTypeId": 1, 
                    "systemPrompt": this.generateRandomSystemPrompt(),
                    "avatarLink":this.getRandomAvatarLink() ,
                    "nonce": captchaResult.nonce, 
                    "captchaText": captchaResult.captchaText.toUpperCase(),
                    "model": "" 
                }
                
                // 设置请求头
                const headers = {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Allowed-State': 'na'
                };
                
                this.logger.info(`准备创建代理: ${agentName} (尝试 ${retryCount + 1}/${maxRetries + 1})`);
                
                // 发送创建代理请求
                const response = await this.client.post(
                    `${this.api3BaseUrl}/agents/create`,
                    requestBody,
                    headers
                );
                // 处理响应
                if (!response.data || response.data.message !== 'Agent created') {
                    throw new Error(`创建代理响应无效或未包含代理ID: ${JSON.stringify(response.data)}`);
                }
                
                const newAgent = response.data.agent;
                const signature = response.data.signature;
                this.logger.info(`成功创建代理: ${newAgent.name} (ID: ${newAgent.id})`);
                
                // 保存代理信息
                this.selectedAgent = newAgent;
                
                let txnHash = null;
                try {
                    const amount = options.amount || 0.4;
                    const value = ethers.utils.parseEther(amount.toString());

                    this.logger.info(`开始执行以太坊交易，创建代理 ${newAgent.id}，金额: ${amount} ETH`);

                    if (!this.ethSigner || !this.ethSigner.wallet) {
                        throw new Error('以太坊签名器未初始化或不可用');
                    }

                    const contractAddress = options.contractAddress || "0x890FD716Cf80B5f9D3CdA34Fc6b1C67CBb2d35c3";

                    const abi = [
                        {
                            "inputs": [
                                {
                                    "internalType": "uint256",
                                    "name": "agentKey",
                                    "type": "uint256"
                                },
                                {
                                    "internalType": "uint256",
                                    "name": "openingBalance",
                                    "type": "uint256"
                                },
                                {
                                    "internalType": "bytes",
                                    "name": "signature",
                                    "type": "bytes"
                                }
                            ],
                            "name": "createAgent",
                            "outputs": [],
                            "stateMutability": "payable",
                            "type": "function"
                        }
                    ];

                    const contract = new ethers.Contract(contractAddress, abi, this.ethSigner.wallet);

                    const tx = await contract.createAgent(
                        BigInt(newAgent.id), // agentKey
                        value,               // openingBalance
                        signature,           // 后端返回的 bytes 格式签名
                        {
                            value: value, // payable金额
                            gasLimit: options.gasLimit || 200000,
                            maxFeePerGas: options.maxFeePerGas || ethers.utils.parseUnits("50", "gwei"),
                            maxPriorityFeePerGas: options.maxPriorityFeePerGas || ethers.utils.parseUnits("2", "gwei"),
                        }
                    );

                    txnHash = tx.hash;
                    this.logger.info(`以太坊交易已提交，交易哈希: ${txnHash}`);

                    const receipt = await tx.wait(1);
                    if (receipt.status === 1) {
                        this.logger.info(`交易确认成功，区块号: ${receipt.blockNumber}`);
                        await this.saveAgentTxnHash(newAgent.id, txnHash);
                        // await this.setAgentBalance(newAgent.id, amount);
                    } else {
                        this.logger.error(`交易确认失败，状态: ${receipt.status}`);
                        throw new Error("交易在链上被回滚");
                    }
                } catch (txError) {
                    this.logger.error(`以太坊交易失败: ${txError.message}`);
                }
                
                // 返回结果
                return {
                    success: true,
                    agent: newAgent,
                    address: this.address,
                    txnHash: txnHash,
                    signature: signature
                };
                
            } catch (error) {
                lastError = error;
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    // 计算指数退避的延迟时间
                    const delay = 2000 * Math.pow(2, retryCount - 1);
                    this.logger.warn(`创建代理失败，尝试第 ${retryCount} 次重试，将等待 ${delay}ms: ${error.message}`);
                    
                    // 等待一段时间后再重试
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // 如果是验证码相关错误，下次重试时重新获取验证码
                    if (error.message.includes('验证码') || error.message.includes('captcha')) {
                        this.logger.info('检测到验证码相关错误，下次重试将重新获取验证码');
                        captchaResult = null;
                    }
                    
                    // 检查是否需要重新验证
                    if (error.message.includes('认证') || error.message.includes('auth') || 
                        error.message.includes('token') || error.message.includes('授权')) {
                        this.logger.warn('可能是认证问题，尝试重新验证');
                        
                        try {
                            // 尝试重新验证
                            const verifyResult = await this.verify();
                            if (!verifyResult.success) {
                                throw new Error(`重新验证失败: ${verifyResult.error}`);
                            }
                            this.logger.info('重新验证成功，继续重试');
                        } catch (verifyError) {
                            this.logger.error(`重新验证失败: ${verifyError.message}`);
                        }
                    }
                } else {
                    // 达到最大重试次数
                    this.logger.error(`创建代理失败，已达到最大重试次数(${maxRetries}): ${lastError.message}`);
                    return {
                        success: false,
                        error: lastError.message,
                        address: this.address,
                        retries: retryCount - 1
                    };
                }
            }
        }
    }
    
    /**
     * 设置代理的余额
     * @param {string} agentId 代理ID
     * @param {number} amount 金额（ETH）
     * @returns {Promise<boolean>} 是否设置成功
     */
    async setAgentBalance(agentId, amount) {
        try {
            this.logger.info(`设置代理 ${agentId} 余额: ${amount} ETH`);
            
            // 验证参数
            if (!agentId || amount === undefined) {
                throw new Error('代理ID和金额不能为空');
            }
            
            // 验证授权
            if (!this.accessToken) {
                throw new Error('未获取访问令牌，请先验证用户');
            }
            
            // 构造请求体
            const requestBody = {
                balance: amount.toString(),
                agentId: agentId
            };
            
            // 设置请求头
            const headers = {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Allowed-State': 'na'
            };
            
            // 发送请求
            const response = await this.client.post(
                `${this.api3BaseUrl}/agents/${agentId}/balance`,
                requestBody,
                headers
            );
            
            // 验证响应
            if (response.status >= 200 && response.status < 300) {
                this.logger.info(`代理余额设置成功: ${amount} ETH`);
                return true;
            } else {
                this.logger.error(`设置代理余额失败，状态码: ${response.status}`);
                throw new Error(`设置代理余额失败，状态码: ${response.status}`);
            }
        } catch (error) {
            this.logger.error(`设置代理余额失败: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 生成代理名称前缀
     * @returns {string} 随机代理名称前缀
     */
    generateAgentNamePrefix() {
        const prefixes = [
            "Fierce", "Digital", "Cyber", "Neural", "Quantum", "Lyrical", "Sonic", 
            "Viral", "Tech", "Rapid", "Urban", "Hyper", "Logic", "Flow", "Rhythm",
            "Echo", "Pulse", "Rhyme", "Beat", "Neon", "Groove", "Wave", "Pixel", "Flux"
        ];
        
        const suffixes = [
            "Verse", "Flow", "Verse", "Rhythm", "Beam", "Drive", "Wave", "Beat",
            "Voice", "Storm", "Force", "Mind", "Soul", "Spirit", "Master", "Forge"
        ];
        
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        
        return prefix + suffix;
    }
    
    /**
     * 使用以太坊进行代理授权
     * @param {number} agentId 代理ID
     * @returns {Promise<string>} 交易哈希
     */
    async authorizeAgentWithEthereum(agentId) {
        try {
            this.logger.info(`开始为代理 ${agentId} 进行以太坊授权`);
            
            // 创建授权消息
            const message = `Authorize agent ${agentId} for FractionAI`;
            
            // 使用以太坊钱包签名
            const signature = await this.ethSigner.signMessage(message);
            
            // 生成模拟交易哈希 - 在实际应用中，这应该是一个真实的以太坊交易
            const txnHash = signature;
            
            this.logger.info(`以太坊授权成功，交易哈希: ${txnHash}`);
            
            return txnHash;
        } catch (error) {
            this.logger.error(`以太坊授权失败: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 保存代理交易哈希
     * @param {string} agentId 代理ID
     * @param {string} txnHash 交易哈希
     * @returns {Promise<boolean>} 是否保存成功
     */
    async saveAgentTxnHash(agentId, txnHash) {
        try {
            this.logger.info(`保存交易哈希到代理 ${agentId}: ${txnHash}`);
            
            // 验证参数
            if (!agentId || !txnHash) {
                throw new Error('代理ID和交易哈希不能为空');
            }
            
            // 验证授权
            if (!this.accessToken) {
                throw new Error('未获取访问令牌，请先验证用户');
            }
            
            // 构造请求体
            const requestBody = {
                txnHash: txnHash,
                agentId: agentId
            };
            
            // 设置请求头
            const headers = {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Allowed-State': 'na'
            };
            
            // 发送请求
            const response = await this.client.post(
                `${this.api3BaseUrl}/agents/saveTxnHash`,
                requestBody,
                headers
            );
            
            // 验证响应
            if (response.status >= 200 && response.status < 300) {
                this.logger.info(`交易哈希保存成功: ${txnHash}`);
                return true;
            } else {
                this.logger.error(`保存交易哈希失败，状态码: ${response.status}`);
                throw new Error(`保存交易哈希失败，状态码: ${response.status}`);
            }
        } catch (error) {
            this.logger.error(`保存交易哈希失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取所有代理的余额信息
     * @returns {Promise<Object>} 余额信息结果对象
     */
    async getAgentsBalances() {
        try {
            if (!this.accessToken || !this.userId) {
                this.logger.error('未获取到访问令牌或用户ID，请先执行verify任务');
                return {
                    success: false,
                    error: '未获取到访问令牌或用户ID，请先执行verify任务',
                    address: this.address
                };
            }
            
            this.logger.info('获取代理余额信息');
            
            // 发送请求获取代理余额
            const response = await this.client.get(
                `${this.api3BaseUrl}/agents/balances`,
                {
                    headers: JSON.stringify({
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Accept': 'application/json',
                        'Allowed-State': 'na'
                    }),
                    headersFormat: 'string'  // 明确指定使用字符串格式
                }
            );
            
            if (!response.data) {
                throw new Error('获取代理余额返回格式不正确');
            }
            
            // 处理返回的余额数据
            let balancesData = response.data;
            
            if (Array.isArray(balancesData)) {
                this.logger.info(`成功获取${balancesData.length}个代理的余额信息`);
                
                // 如果已经有选定的代理，更新其余额信息
                if (this.selectedAgent) {
                    const agentBalance = balancesData.find(b => (b.id === this.selectedAgent.id || b.agentId === this.selectedAgent.id));
                    if (agentBalance) {
                        this.logger.info(`更新代理 ${this.selectedAgent.id} 的余额信息`);
                        this.selectedAgent.balance = agentBalance.balance;
                        this.logger.info(`代理 ${this.selectedAgent.id} 当前余额: ${agentBalance.balance} ETH`);
                    }
                }
            } else if (balancesData.balances && Array.isArray(balancesData.balances)) {
                balancesData = balancesData.balances;
                this.logger.info(`成功获取${balancesData.length}个代理的余额信息`);
                
                // 如果已经有选定的代理，更新其余额信息
                if (this.selectedAgent) {
                    const agentBalance = balancesData.find(b => (b.id === this.selectedAgent.id || b.agentId === this.selectedAgent.id));
                    if (agentBalance) {
                        this.logger.info(`更新代理 ${this.selectedAgent.id} 的余额信息`);
                        this.selectedAgent.balance = agentBalance.balance;
                        this.logger.info(`代理 ${this.selectedAgent.id} 当前余额: ${agentBalance.balance} ETH`);
                    }
                }
            } else {
                this.logger.warn('无法解析代理余额数据格式');
            }
            
            return {
                success: true,
                balances: balancesData,
                address: this.address
            };
        } catch (error) {
            this.logger.error(`获取代理余额失败: ${error.message}`);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }
    
    /**
     * 检查代理余额是否足够
     * @param {number} minimumBalance 最小余额要求（以太）
     * @returns {Promise<boolean>} 余额是否足够
     */
    async checkAgentBalance(minimumBalance = 0.5) {
        try {
            if (!this.selectedAgent) {
                this.logger.error('未选择智能代理，无法检查余额');
                return false;
            }
            
            // 先尝试使用最新的API获取余额信息
            const balancesResult = await this.getAgentsBalances();
            if (balancesResult.success) {
                // 如果成功获取到最新余额，直接检查
                if (this.selectedAgent.balance !== undefined) {
                    let balance = 0;
                    
                    // 处理不同可能的数据类型
                    if (typeof this.selectedAgent.balance === 'number') {
                        balance = this.selectedAgent.balance;
                    } else if (typeof this.selectedAgent.balance === 'string') {
                        // 移除可能的字符串格式并转为数字
                        balance = parseFloat(this.selectedAgent.balance.replace(/[^0-9.]/g, ''));
                    }
                    
                    this.logger.info(`代理 ${this.selectedAgent.id} 当前余额: ${balance} ETH`);
                    return balance >= minimumBalance;
                }
            }
            
            // 如果无法通过新API获取，尝试使用旧方法
            this.logger.info('尝试使用备用方法获取代理余额');
            
            // 如果代理对象中有lockedBalance属性，直接使用
            if (this.selectedAgent.lockedBalance !== undefined) {
                let balance = 0;
                
                // 处理不同可能的数据类型
                if (typeof this.selectedAgent.lockedBalance === 'number') {
                    balance = this.selectedAgent.lockedBalance;
                } else if (typeof this.selectedAgent.lockedBalance === 'string') {
                    // 移除可能的字符串格式并转为数字
                    balance = parseFloat(this.selectedAgent.lockedBalance.replace(/[^0-9.]/g, ''));
                }
                
                this.logger.info(`代理 ${this.selectedAgent.id} 当前余额(使用lockedBalance): ${balance} ETH`);
                return balance >= minimumBalance;
            }
            
            // 如果没有直接的余额信息，尝试通过API获取
            this.logger.info(`尝试获取代理 ${this.selectedAgent.id} 的详细信息`);
            
            const response = await this.client.get(
                `${this.api3BaseUrl}/agents/${this.selectedAgent.id}`,
                {
                    headers: JSON.stringify({
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Accept': 'application/json',
                        'Allowed-State': 'na'
                    }),
                    headersFormat: 'string'
                }
            );
            
            if (response.data && response.data.lockedBalance !== undefined) {
                let balance = 0;
                
                if (typeof response.data.lockedBalance === 'number') {
                    balance = response.data.lockedBalance;
                } else if (typeof response.data.lockedBalance === 'string') {
                    balance = parseFloat(response.data.lockedBalance.replace(/[^0-9.]/g, ''));
                }
                
                this.logger.info(`代理 ${this.selectedAgent.id} 当前余额(API): ${balance} ETH`);
                return balance >= minimumBalance;
            }
            
            this.logger.warn(`无法确定代理 ${this.selectedAgent.id} 的余额，默认认为不足`);
            return false;
        } catch (error) {
            this.logger.error(`检查代理余额失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 启用自动匹配
     * @param {Object} options 配置选项
     * @param {number} options.maxGames 最大游戏数量
     * @param {string} options.entryFee 入场费
     * @returns {Promise<Object>} 结果对象
     */
    async enableAutomatedMatchmaking(options = {}) {
        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;
        let captchaResult = null;

        while (retryCount <= maxRetries) {
            try {
                if (!this.accessToken || !this.userId) {
                    this.logger.error('未获取到访问令牌或用户ID，请先执行verify任务');
                    return {
                        success: false,
                        error: '未获取到访问令牌或用户ID，请先执行verify任务',
                        address: this.address
                    };
                }
                if (!this.selectedAgent || !this.selectedAgent.id) {
                    this.logger.error('未选择智能代理，请先执行getUserAgents任务');
                    return {
                        success: false,
                        error: '未选择智能代理，请先执行getUserAgents任务',
                        address: this.address
                    };
                }
                
                // 检查是否已经启用了自动匹配
                if (this.selectedAgent.automationEnabled === true) {
                    this.logger.info(`代理 ${this.selectedAgent.id} 自动匹配已经是启用状态，跳过启用操作`);
                    return {
                        success: true,
                        message: '自动匹配已经是启用状态',
                        address: this.address
                    };
                }
                
                this.logger.info(`准备为代理 ${this.selectedAgent.id} 启用自动匹配 (尝试 ${retryCount + 1}/${maxRetries + 1})`);
                
                // 仅在首次尝试或验证码失败时重新获取验证码
                if (!captchaResult || !captchaResult.success) {
                    // 获取验证码
                    captchaResult = await this.getCaptchaForCreateAgent();
                    
                    if (!captchaResult.success) {
                        throw new Error(`获取验证码失败: ${captchaResult.error}`);
                    }
                }
                
                // 获取环境变量中的MAX_GAMES或者配置中的值
                let maxGames = options.maxGames;
                if (maxGames === undefined) {
                    // 尝试从环境变量获取
                    maxGames = process.env.MAX_GAMES || config.fractionAI.maxGames || 10;
                    // 确保它是数字类型
                    maxGames = parseInt(maxGames, 10);
                    if (isNaN(maxGames)) {
                        maxGames = 10; // 默认值
                    }
                }
                
                // 合并选项和默认设置
                const settings = {
                    maxGames: maxGames,
                    // 确保entryFee是数值字符串，不使用科学计数法
                    entryFee: options.entryFee || config.fractionAI.entryFee || 0.001
                };
                
                this.logger.info(`自动匹配设置: 最大游戏数量=${settings.maxGames}, 入场费=${settings.entryFee} ETH`);
                // 调整请求体格式，只包含必要参数
                const requestBody = {
                    "agentId":this.selectedAgent.id,
                    "sessionTypeId":1,
                    "maxGames":settings.maxGames,
                    "stopLoss":0.5,
                    "takeProfit":0.1,
                    "feeTier":settings.entryFee,
                    "maxParallelGames":10,
                    "nonce":captchaResult.nonce,
                    "captchaText":captchaResult.captchaText.toUpperCase()
                };
                const headers = {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Allowed-State': 'na'
                };
                // 发送请求
                const response = await this.client.post(
                    `${this.api3BaseUrl}/automated-matchmaking/enable`,
                    requestBody,
                    headers
                );

                this.logger.debug(`启用自动匹配API响应: ${JSON.stringify(response.data)}`);
                if (response.data && (response.data.message ===  'Automated matchmaking enabled successfully')) {
                    this.logger.info(`代理 ${this.selectedAgent.id} 自动匹配已成功启用`);
                    // 更新代理状态
                    if (this.selectedAgent) {
                        this.selectedAgent.automationEnabled = true;
                        this.selectedAgent.automationMaxGames = settings.maxGames;
                        this.selectedAgent.automationGamesPlayed = 0;
                    }
                    return {
                        success: true,
                        data: response.data,
                        address: this.address
                    };
                }
                
                this.logger.error(`启用自动匹配失败，意外的响应: ${JSON.stringify(response.data)}`);
                throw new Error(`启用自动匹配失败，意外的响应格式: ${JSON.stringify(response.data)}`);
                
            } catch (error) {
                lastError = error;
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    // 计算指数退避的延迟时间
                    const delay = 2000 * Math.pow(2, retryCount - 1);
                    this.logger.warn(`启用自动匹配失败，尝试第 ${retryCount} 次重试，将等待 ${delay}ms: ${error.message}`);
                    
                    // 等待一段时间后再重试
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // 如果是验证码相关错误，下次重试时重新获取验证码
                    if (error.message.includes('验证码') || error.message.includes('captcha')) {
                        this.logger.info('检测到验证码相关错误，下次重试将重新获取验证码');
                        captchaResult = null;
                    }
                    
                    // 检查是否需要重新验证
                    if (error.message.includes('认证') || error.message.includes('auth') || 
                        error.message.includes('token') || error.message.includes('授权')) {
                        this.logger.warn('可能是认证问题，尝试重新验证');
                        
                        try {
                            // 尝试重新验证
                            const verifyResult = await this.verify();
                            if (!verifyResult.success) {
                                throw new Error(`重新验证失败: ${verifyResult.error}`);
                            }
                            this.logger.info('重新验证成功，继续重试');
                        } catch (verifyError) {
                            this.logger.error(`重新验证失败: ${verifyError.message}`);
                        }
                    }
                } else {
                    // 达到最大重试次数
                    this.logger.error(`启用自动匹配失败，已达到最大重试次数(${maxRetries}): ${lastError.message}`);
                    return {
                        success: false,
                        error: lastError.message,
                        address: this.address,
                        retries: retryCount - 1
                    };
                }
            }
        }
    }
    
   
    /**
     * 禁用自动匹配功能
     * @returns {Promise<Object>} 禁用结果
     */
    async disableAutomatedMatchmaking() {
        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;

        while (retryCount <= maxRetries) {
            try {
                // 验证是否已经获取到accessToken和用户代理
                if (!this.accessToken || !this.userId) {
                    this.logger.error('未获取到访问令牌或用户ID，请先执行verify任务');
                    return {
                        success: false,
                        error: '未获取到访问令牌或用户ID，请先执行verify任务',
                        address: this.address
                    };
                }
                
                if (!this.selectedAgent) {
                    this.logger.error('未选择智能代理，请先执行getUserAgents或createAgent任务');
                    return {
                        success: false,
                        error: '未选择智能代理，请先执行getUserAgents或createAgent任务',
                        address: this.address
                    };
                }
                
                // 如果自动匹配已经禁用，则直接返回成功
                if (this.selectedAgent.automationEnabled === false) {
                    this.logger.info(`代理 ${this.selectedAgent.id} 自动匹配已经是禁用状态，跳过禁用操作`);
                    return {
                        success: true,
                        message: '自动匹配已经是禁用状态',
                        address: this.address
                    };
                }
                
                this.logger.info(`准备为代理 ${this.selectedAgent.id} 禁用自动匹配 (尝试 ${retryCount + 1}/${maxRetries + 1})`);
                const headers = {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Allowed-State': 'na'
                };
                // 发送请求 - 注意这里使用的是特定的URL格式，包含代理ID
                const response = await this.client.post(
                    `${this.api3BaseUrl}/automated-matchmaking/disable/${this.selectedAgent.id}`,
                    {}, // 空对象作为参数
                    headers  
                );
                
                this.logger.info(`自动匹配成功禁用，代理ID: ${this.selectedAgent.id}`);
                
                // 更新代理的自动匹配状态
                if (this.selectedAgent) {
                    this.selectedAgent.automationEnabled = false;
                }
                
                return {
                    success: true,
                    data: response.data,
                    address: this.address
                };
            } catch (error) {
                lastError = error;
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    // 计算指数退避的延迟时间
                    const delay = 2000 * Math.pow(2, retryCount - 1);
                    this.logger.warn(`禁用自动匹配失败，尝试第 ${retryCount} 次重试，将等待 ${delay}ms: ${error.message}`);
                    
                    // 等待一段时间后再重试
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // 检查是否需要重新验证
                    if (error.message.includes('认证') || error.message.includes('auth') || 
                        error.message.includes('token') || error.message.includes('授权')) {
                        this.logger.warn('可能是认证问题，尝试重新验证');
                        
                        try {
                            // 尝试重新验证
                            const verifyResult = await this.verify();
                            if (!verifyResult.success) {
                                throw new Error(`重新验证失败: ${verifyResult.error}`);
                            }
                            this.logger.info('重新验证成功，继续重试');
                        } catch (verifyError) {
                            this.logger.error(`重新验证失败: ${verifyError.message}`);
                        }
                    }
                } else {
                    // 达到最大重试次数
                    this.logger.error(`禁用自动匹配失败，已达到最大重试次数(${maxRetries}): ${lastError.message}`);
                    return {
                        success: false,
                        error: lastError.message,
                        address: this.address,
                        retries: retryCount - 1
                    };
                }
            }
        }
    }
    
    /**
     * 检查自动匹配状态并根据需要启用或禁用
     * @returns {Promise<Object>} 检查结果
     */
    async checkAutomationStatus() {
        try {
            // 首先获取用户代理
            if (!this.selectedAgent) {
                this.logger.warn('未选择智能代理，无法检查自动匹配状态');
                return {
                    success: false,
                    error: '未选择智能代理，无法检查自动匹配状态',
                    address: this.address
                };
            }
            
            // 直接检查代理的自动匹配状态
            if (this.selectedAgent.automationEnabled === undefined || this.selectedAgent.automationEnabled === false) {
                this.logger.info(`代理 ${this.selectedAgent.id} 自动匹配未启用或状态未知，需要启用`);
                // 仅在未启用时启用自动匹配
                return await this.enableAutomatedMatchmaking();
            } else {
                this.logger.info(`代理 ${this.selectedAgent.id} 自动匹配已启用，无需操作`);
                // 直接返回成功
                return {
                    success: true,
                    message: '自动匹配已启用，无需操作',
                    address: this.address
                };
            }
        } catch (error) {
            this.logger.error(`检查自动匹配状态失败: ${error.message}`, error);
            return {
                success: false,
                error: error.message,
                address: this.address
            };
        }
    }

    /**
     * 生成随机系统提示
     * @returns {string} 随机系统提示（长度不超过1100字符）
     */
    generateRandomSystemPrompt() {
        // 风格描述集合
        const styles = [
            "aggressive yet clever", "razor-sharp", "intellectual yet street-smart", 
            "visionary", "battle-hardened", "technical yet emotional", "charismatic", 
            "lyrical", "philosophical", "poetic", "enigmatic", "authentic", "relentless",
            "methodical", "passionate", "unorthodox", "witty", "explosive", "calculated"
        ];
        
        // 技能描述集合
        const skills = [
            "blending intricate wordplay with captivating flow", 
            "combining technical precision with raw emotional impact",
            "transforming ordinary concepts into extraordinary verses",
            "turning any topic into compelling verses with perfect timing",
            "displaying masterful command of multisyllabic rhymes",
            "shifting between aggressive attacks and calm dismantling of opponents",
            "constructing elaborate verbal structures with flawless execution",
            "blending personal attacks with broader social observations"
        ];
        
        // 开场语集合
        const intros = [
            "You are an unmatched lyrical warrior in the rap battle arena",
            "You are a master of verbal combat in the world of battle rap",
            "You are a legendary figure in competitive lyrical warfare",
            "You are a revolutionary voice in the battle rap scene",
            "You are the embodiment of rap battle excellence",
            "You are a charismatic battle performer with unmatched presence"
        ];
        
        // 连接词集合
        const connectors = [
            ", ", ". ", " - ", " who is ", " while ", ". You are ", 
            ", embodying ", " and ", ". Your approach is ", " with "
        ];
        
        // 结束语集合
        const closings = [
            "Your presence dominates the stage, leaving opponents reeling and fans in awe.",
            "You command respect through both technical skill and authentic delivery.",
            "Your verses resonate deeply, creating lasting impact beyond the battle itself.",
            "You set the standard for excellence in every aspect of battle performance."
        ];
        
        // 焦点和目标集合
        const focuses = [
            "Stay on topic while showcasing creativity and originality in every verse.",
            "Analyze opponents with precision, crafting comebacks that feel both fresh and devastating.",
            "Focus on advanced rhyme schemes that enhance your already captivating delivery.",
            "Channel unique energy into each battle, ensuring words resonate authentically."
        ];
        
        // 创建随机组合
        const randomIntro = intros[Math.floor(Math.random() * intros.length)];
        const randomStyle = styles[Math.floor(Math.random() * styles.length)];
        const randomConnector1 = connectors[Math.floor(Math.random() * connectors.length)];
        const randomSkill = skills[Math.floor(Math.random() * skills.length)];
        const randomConnector2 = connectors[Math.floor(Math.random() * connectors.length)];
        const randomFocus = focuses[Math.floor(Math.random() * focuses.length)];
        const randomClosing = closings[Math.floor(Math.random() * closings.length)];
        
        // 随机决定是否包含每个部分
        const includeStyle = Math.random() > 0.1; // 90%的几率包含
        const includeSkill = Math.random() > 0.1; // 90%的几率包含
        const includeFocus = Math.random() > 0.3; // 70%的几率包含
        const includeClosing = Math.random() > 0.3; // 70%的几率包含
        
        // 构建提示
        let prompt = randomIntro;
        
        if (includeStyle) {
            prompt += randomConnector1 + randomStyle;
        }
        
        if (includeSkill) {
            const connector = includeStyle ? ", " : randomConnector1;
            prompt += connector + randomSkill;
        }
        
        if (includeFocus) {
            prompt += ". " + randomFocus;
        }
        
        if (includeClosing) {
            prompt += " " + randomClosing;
        }
        
        // 确保提示以句号结尾
        if (!prompt.endsWith(".")) {
            prompt += ".";
        }
        
        // 确保提示不超过1100字符
        if (prompt.length > 1100) {
            // 如果超出长度，简化提示
            prompt = randomIntro;
            if (prompt.length + randomFocus.length + 2 <= 1100) {
                prompt += ". " + randomFocus;
            }
            if (prompt.length + 1 <= 1100) {
                prompt += ".";
            }
        }
        
        this.logger.debug(`生成的系统提示长度: ${prompt.length}字符`);
        return prompt;
    }

    /**
     * 获取随机头像链接
     * @returns {string} 随机头像链接
     */
    getRandomAvatarLink() {
        const defaultAvatars = [
            "https://neural-arena-upload.s3.ap-south-1.amazonaws.com/avatars/61fd867decea4fe927e5a846b8d0d7f1.svg",
            "https://neural-arena-upload.s3.ap-south-1.amazonaws.com/avatars/8fafe7baef8d0a53e9908073e37eaa07.svg",
            "https://neural-arena-upload.s3.ap-south-1.amazonaws.com/avatars/e6cd68176f7f3bd866d5c8b41013efde.svg",
            "https://neural-arena-upload.s3.ap-south-1.amazonaws.com/avatars/d8c8937b8005cbaedae91df5c2060961.svg"
        ];
        
        const randomAvatarIndex = Math.floor(Math.random() * defaultAvatars.length);
        return defaultAvatars[randomAvatarIndex];
    }

    /**
     * 获取验证码解决器
     * @returns {CaptchaSolver} 验证码解决器实例
     */
    getCaptchaSolver() {
        if (!this.captchaSolver) {
            const CaptchaSolver = require('../utils/CaptchaSolver');
            
            if (!config.captcha.service || !config.captcha.apiKey) {
                throw new Error('验证码服务未配置，请设置CAPTCHA_SERVICE和CAPTCHA_API_KEY');
            }
            
            this.captchaSolver = new CaptchaSolver(
                config.captcha.service,
                config.captcha.apiKey,
                {
                    pollingInterval: 5000,
                    timeout: 180000,
                    debug: false,
                    maxRetries: 3,
                    retryDelay: 5000
                }
            );
        }
        
        return this.captchaSolver;
    }

    /**
     * 获取验证nonce
     * @returns {Promise<Object>} 包含nonce的响应对象
     */
    async getNonce() {
        try {
            this.logger.info('获取验证nonce...');
            
            // 设置请求头
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            // 构造请求体
            const data = {
                address: this.address
            };
            
            // 发送请求
            const response = await this.client.get(
                `${this.api3BaseUrl}/auth/nonce`,
                data,
                headers
            );
            // 检查响应
            if (!response.data || !response.data.nonce) {
                throw new Error('获取nonce失败，响应中无nonce字段');
            }
            
            this.logger.info(`成功获取nonce: ${response.data.nonce}`);
            return response.data;
        } catch (error) {
            this.logger.error(`获取nonce失败: ${error.message}`);
            throw error;
        }
    }
}

module.exports = FractionAIHandler; 
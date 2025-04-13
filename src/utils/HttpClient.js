/**
 * HTTP客户端类
 * 封装HTTP请求，支持请求限制、重试和JA3指纹模拟
 */
const initCycleTLS = require('cycletls');
const delay = require('delay');
const Logger = require('./Logger');
const config = require('../config');

// 客户端实例
let cycleTLSClient = null;
// 初始化状态标记
let isInitializing = false;
// 初始化完成的Promise
let initPromise = null;

class HttpClient {
    /**
     * 构造函数
     * @param {Object} options 配置选项
     * @param {Object} [options.proxy] 代理配置
     * @param {string} [options.ja3Fingerprint] JA3指纹
     * @param {number} [options.timeout] 超时时间(毫秒)
     * @param {boolean} [options.followRedirects] 是否跟随重定向
     * @param {number} [options.maxRetries] 最大重试次数
     * @param {number} [options.retryDelay] 重试间隔(毫秒)
     * @param {number} [options.rateLimit] 请求速率限制(每分钟请求数)
     */
    constructor(options = {}) {
        this.options = {
            proxy: null,
            ja3Fingerprint: this.getRandomJa3Fingerprint(),
            timeout: 60000, // 增加默认超时时间到60秒
            followRedirects: true,
            maxRetries: 3,
            retryDelay: 2000,
            rateLimit: 30,
            ...options,
            // 添加详细的TLS超时配置
            dialTimeout: 30,
            readTimeout: 30,
            writeTimeout: 30,
            responseTimeout: 30,
            keepAlive: true,
            keepAliveTimeout: 30,
            maxIdleConns: 100,
            maxIdleConnsPerHost: 10,
            idleConnTimeout: 30
        };
        
        this.logger = new Logger('HttpClient');
        this.requestTimestamps = []; // 记录请求时间戳，用于限速
        
        // 记录特定URL路径的headers格式 {'auth/nonce': 'string', 'agents/user': 'object'}
        this.endpointHeadersFormat = {};
        
        // 默认headers格式
        this.defaultHeadersFormat = 'object';
    }
    
    /**
     * 从URL中提取端点路径，用于记录和查询格式
     * @param {string} url 完整URL
     * @returns {string} 端点路径
     */
    getEndpointKey(url) {
        try {
            // 尝试提取路径部分
            const urlObj = new URL(url);
            // 获取路径部分后的第一段作为键
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
                return pathParts[pathParts.length - 1]; // 使用最后一段作为键
            }
            return '';
        } catch (e) {
            // 在URL解析失败的情况下，提取/之后的部分
            const parts = url.split('/');
            if (parts.length > 0) {
                return parts[parts.length - 1].split('?')[0]; // 使用最后一段并去除查询参数
            }
            return '';
        }
    }
    
    /**
     * 获取特定端点的headers格式
     * @param {string} url 请求URL
     * @returns {string} headers格式 ('object'或'string')
     */
    getHeadersFormatForEndpoint(url) {
        const endpointKey = this.getEndpointKey(url);
        
        // 如果有该端点的记录，使用记录的格式
        if (endpointKey && this.endpointHeadersFormat[endpointKey]) {
            return this.endpointHeadersFormat[endpointKey];
        }
        
        // 否则使用默认格式
        return this.defaultHeadersFormat;
    }
    
    /**
     * 更新端点的headers格式
     * @param {string} url 请求URL
     * @param {string} format headers格式 ('object'或'string')
     */
    updateHeadersFormatForEndpoint(url, format) {
        const endpointKey = this.getEndpointKey(url);
        if (endpointKey) {
            this.endpointHeadersFormat[endpointKey] = format;
            this.logger.debug(`为端点 ${endpointKey} 更新headers格式为 ${format}`);
        }
    }
    
    /**
     * 初始化CycleTLS客户端
     * @returns {Promise<any>} CycleTLS客户端实例
     */
    async initClient() {
        if (!cycleTLSClient && !isInitializing) {
            isInitializing = true;
            
            if (!initPromise) {
                initPromise = (async () => {
                    try {
                        cycleTLSClient = await initCycleTLS();
                        return cycleTLSClient;
                    } catch (error) {
                        throw error;
                    } finally {
                        isInitializing = false;
                    }
                })();
            }
            
            await initPromise;
        } else if (isInitializing) {
            // 如果正在初始化，等待完成
            await initPromise;
        }
        
        return cycleTLSClient;
    }
    
    /**
     * 获取随机JA3指纹
     * @returns {string} JA3指纹
     */
    getRandomJa3Fingerprint() {
        // 先检查配置中是否有JA3指纹列表
        if (config.security && config.security.ja3Fingerprints && config.security.ja3Fingerprints.length > 0) {
            return config.security.ja3Fingerprints[
                Math.floor(Math.random() * config.security.ja3Fingerprints.length)
            ];
        }
        
        // 如果配置中没有，使用常用的JA3指纹
        const commonJA3 = [
            // Chrome 浏览器
            "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
            // Firefox 浏览器
            "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0",
            // Safari 浏览器
            "771,49196-49195-49188-49187-49162-49161-52393-49200-49199-49192-49191-49172-49171-52392,0-13-5-11-43-10-27-51-35-16-17513,29-23-24,0"
        ];
        
        return commonJA3[Math.floor(Math.random() * commonJA3.length)];
    }
    
    /**
     * 获取完整的代理URL
     * @returns {string|null} 代理URL或null
     */
    getProxyUrl() {
        if (!this.options.proxy || !this.options.proxy.host) {
            return null;
        }
        
        let proxyUrl = `http://`;
        
        if (this.options.proxy.username && this.options.proxy.password) {
            proxyUrl += `${this.options.proxy.username}:${this.options.proxy.password}@`;
        }
        
        proxyUrl += `${this.options.proxy.host}:${this.options.proxy.port}`;
        return proxyUrl;
    }
    
    /**
     * 检查请求限制
     * @returns {Promise<void>}
     */
    async checkRateLimit() {
        if (!this.options.rateLimit) {
            return;
        }
        
        const now = Date.now();
        
        // 移除超过1分钟的记录
        this.requestTimestamps = this.requestTimestamps.filter(
            timestamp => now - timestamp < 60000
        );
        
        // 如果请求数超过限制，等待
        if (this.requestTimestamps.length >= this.options.rateLimit) {
            const oldestRequest = this.requestTimestamps[0];
            const waitTime = Math.max(1, oldestRequest + 60000 - now);
            
            this.logger.debug(`请求达到限制，等待 ${waitTime}ms`);
            await delay(waitTime);
            
            // 递归检查
            return this.checkRateLimit();
        }
        
        // 添加当前请求时间戳
        this.requestTimestamps.push(now);
    }
    
    /**
     * 关闭客户端
     */
    async close() {
        if (cycleTLSClient) {
            try {
                await cycleTLSClient.exit();
                this.logger.info('CycleTLS客户端已关闭');
            } catch (error) {
                this.logger.error(`关闭CycleTLS客户端失败: ${error.message}`);
            }
            cycleTLSClient = null;
            initPromise = null;
            isInitializing = false;
        }
    }
    
    /**
     * 设置默认请求格式和重试机制
     * @param {Object} options 请求选项
     * @returns {Object} 处理后的请求选项
     */
    prepareRequestOptions(options = {}) {
        const finalOptions = { ...options };
        
        // 提取关键部分用于确定端点
        let endpointKey = 'default';
        if (finalOptions.url) {
            // 从URL提取端点特征
            const urlParts = finalOptions.url.split('/');
            endpointKey = urlParts[urlParts.length - 1]; // 使用路径的最后一部分作为端点键
        }
        
        // 检查端点记忆表中是否有此端点的格式记录
        if (endpointKey !== 'default' && this.endpointHeadersFormat[endpointKey]) {
            finalOptions.headersFormat = this.endpointHeadersFormat[endpointKey];
            this.logger.debug(`从记忆表中获取端点 ${endpointKey} 的headers格式: ${finalOptions.headersFormat}`);
        } else if (!finalOptions.headersFormat) {
            // 对于关键端点，强制使用指定格式
            if (endpointKey === 'nonce') {
                finalOptions.headersFormat = 'string';
                this.logger.debug(`对于nonce端点强制使用string格式`);
            } else {
                finalOptions.headersFormat = this.defaultHeadersFormat;
            }
        }
        
        // 处理headers，确保格式正确
        if (finalOptions.headers) {
            if (finalOptions.headersFormat === 'string' && typeof finalOptions.headers !== 'string') {
                finalOptions.headers = JSON.stringify(finalOptions.headers);
            } else if (finalOptions.headersFormat === 'object' && typeof finalOptions.headers === 'string') {
                try {
                    finalOptions.headers = JSON.parse(finalOptions.headers);
                } catch (error) {
                    this.logger.warn(`无法将headers从字符串解析为对象: ${error.message}`);
                }
            }
        }
        
        // 添加超时设置
        if (!finalOptions.timeout && this.options.timeout) {
            finalOptions.timeout = this.options.timeout;
        }
        
        // 记录当前请求的headers格式
        const headerFormatMsg = finalOptions.headersFormat === 'string' 
            ? '字符串' 
            : (finalOptions.headersFormat === 'object' ? '对象' : '未知');
        this.logger.debug(`请求将使用${headerFormatMsg}格式的headers`);
        
        // 处理responseType
        if (options.responseType && !finalOptions.responseType) {
            finalOptions.responseType = options.responseType;
            this.logger.debug(`请求将使用responseType: ${finalOptions.responseType}`);
        }
        
        return finalOptions;
    }
    
    /**
     * 处理请求错误并尝试自动修复
     * @param {Error} error 请求错误
     * @param {Object} options 原始请求选项 
     * @returns {Object} 修复后的请求选项
     */
    handleRequestError(error, options) {
        // 检查是否是headers格式错误
        if (error.message && (
            error.message.includes('Unmarshal Error') || 
            error.message.includes('cannot unmarshal object') || 
            error.message.includes('headers of type string')
        )) {
            this.logger.warn(`检测到headers格式错误：${error.message}`);
            
            // 提取端点标识符
            let endpointKey = 'default';
            if (options.url) {
                const urlParts = options.url.split('/');
                endpointKey = urlParts[urlParts.length - 1];
            }
            
            // 切换headers格式
            const newFormat = options.headersFormat === 'string' ? 'object' : 'string';
            this.logger.info(`正在切换端点 ${endpointKey} 的headers格式从 ${options.headersFormat} 到 ${newFormat}`);
            
            // 更新端点格式记忆
            this.endpointHeadersFormat[endpointKey] = newFormat;
            
            // 返回修复后的选项
            const fixedOptions = { ...options, headersFormat: newFormat };
            
            // 转换headers格式
            if (fixedOptions.headers) {
                if (newFormat === 'string' && typeof fixedOptions.headers !== 'string') {
                    fixedOptions.headers = JSON.stringify(fixedOptions.headers);
                } else if (newFormat === 'object' && typeof fixedOptions.headers === 'string') {
                    try {
                        fixedOptions.headers = JSON.parse(fixedOptions.headers);
                    } catch (err) {
                        this.logger.error(`无法将headers从字符串解析为对象: ${err.message}`);
                    }
                }
            }
            
            return fixedOptions;
        }
        
        // 其他类型的错误，不修改选项
        return options;
    }
    
    /**
     * 发送请求
     * @param {string} method 请求方法
     * @param {string} url 请求URL
     * @param {Object} [data] 请求数据
     * @param {Object} [headers] 请求头
     * @param {Object} [options] 请求选项
     * @returns {Promise<Object>} 响应结果
     */
    async request(method, url, data = null, headers = {}, options = {}) {
        const requestOptions = this.prepareRequestOptions(options);
        
        // 检查请求限制
        await this.checkRateLimit();
        
        // 获取客户端实例
        const client = await this.initClient();
        
        let retryCount = 0;
        
        // 获取该端点的headers格式
        let headersFormat = this.getHeadersFormatForEndpoint(url);
        
        while (true) {
            try {
                this.logger.debug(`发送 ${method} 请求: ${url}`);
                
                // 合并默认和用户提供的headers
                const mergedHeaders = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Connection': 'keep-alive',
                    ...headers
                };
                
                // 准备两种格式的headers
                const objectHeaders = { ...mergedHeaders };
                const stringHeaders = Object.entries(mergedHeaders)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n');
                
                this.logger.debug(`当前端点 ${this.getEndpointKey(url)} 使用headers格式: ${headersFormat}`);
                
                // 构建请求配置
                const requestConfig = {
                    // 根据当前format选择headers格式
                    headers: headersFormat === 'object' ? objectHeaders : stringHeaders,
                    timeout: Math.floor(requestOptions.timeout / 1000), // CycleTLS使用秒为单位
                    ja3: this.options.ja3Fingerprint,
                    proxy: this.getProxyUrl(),
                    disableRedirect: !this.options.followRedirects,
                    // 添加详细超时和连接配置
                    dialTimeout: this.options.dialTimeout,
                    readTimeout: this.options.readTimeout,
                    writeTimeout: this.options.writeTimeout,
                    responseTimeout: this.options.responseTimeout,
                    keepAlive: this.options.keepAlive,
                    keepAliveTimeout: this.options.keepAliveTimeout,
                    maxIdleConns: this.options.maxIdleConns,
                    maxIdleConnsPerHost: this.options.maxIdleConnsPerHost,
                    idleConnTimeout: this.options.idleConnTimeout
                };
                
                // 添加responseType
                if (options.responseType === 'arraybuffer') {
                    requestConfig.responseType = 'arraybuffer';
                }
                
                this.logger.debug(`当前headers格式: ${headersFormat}, JA3指纹: ${this.options.ja3Fingerprint}`);
                this.logger.debug(`请求配置: ${JSON.stringify({
                    url,
                    method: method.toUpperCase(),
                    timeout: requestConfig.timeout,
                    headersFormat,
                    hasProxy: !!requestConfig.proxy
                })}`);
                
                // 添加请求数据
                if (data) {
                    if (method.toUpperCase() === 'GET') {
                        // 对于GET请求，将数据添加到URL中
                        const searchParams = new URLSearchParams();
                        for (const key in data) {
                            searchParams.append(key, data[key]);
                        }
                        url = `${url}${url.includes('?') ? '&' : '?'}${searchParams.toString()}`;
                    } else {
                        // 对于POST/PUT等请求，将数据添加到body中
                        if (mergedHeaders['Content-Type'] && mergedHeaders['Content-Type'].includes('application/x-www-form-urlencoded')) {
                            // 表单数据
                            const formData = new URLSearchParams();
                            for (const key in data) {
                                formData.append(key, data[key]);
                            }
                            requestConfig.body = formData.toString();
                        } else {
                            // 默认使用JSON
                            requestConfig.body = JSON.stringify(data);
                            // 如果没有指定Content-Type，添加它
                            if (!mergedHeaders['Content-Type']) {
                                if (headersFormat === 'object') {
                                    requestConfig.headers['Content-Type'] = 'application/json';
                                } else {
                                    // 为stringHeaders添加Content-Type
                                    requestConfig.headers += '\nContent-Type: application/json';
                                }
                            }
                        }
                    }
                }
                
                // 发送请求
                const response = await client(url, requestConfig, method.toUpperCase());
                
                // 处理响应
                let responseData = response.body;
                
                // 根据responseType处理响应内容
                if (options.responseType === 'arraybuffer' && typeof responseData === 'string') {
                    // 将字符串转换为Buffer
                    this.logger.debug('将响应转换为Buffer格式');
                    responseData = Buffer.from(responseData, 'binary');
                } else if (responseData && response.headers['content-type'] && response.headers['content-type'].includes('application/json')) {
                    // 尝试解析JSON
                    try {
                        responseData = JSON.parse(responseData);
                    } catch (e) {
                        this.logger.warn(`JSON解析失败: ${e.message}`);
                        // 如果解析失败，保持原始数据
                    }
                }
                
                return {
                    status: response.status,
                    statusText: response.statusText || '',
                    headers: response.headers,
                    data: responseData
                };
            } catch (error) {
                // 处理请求错误
                const fixedOptions = this.handleRequestError(error, requestOptions);
                
                // 判断是否需要重试
                if (retryCount < fixedOptions.maxRetries) {
                    retryCount++;
                    
                    const waitTime = fixedOptions.retryDelay * Math.pow(2, retryCount - 1);
                    this.logger.warn(`请求失败，${retryCount}/${fixedOptions.maxRetries} 次重试，等待 ${waitTime}ms: ${error.message}`);
                    
                    await delay(waitTime);
                    
                    // 如果出现错误，重置客户端
                    if (cycleTLSClient) {
                        try {
                            // 尝试关闭客户端
                            await cycleTLSClient.exit();
                        } catch (e) {
                            // 忽略关闭错误
                        } finally {
                            // 重置客户端状态
                            cycleTLSClient = null;
                            initPromise = null;
                            isInitializing = false;
                        }
                    }
                    
                    // 重新获取客户端并更换JA3指纹
                    this.options.ja3Fingerprint = this.getRandomJa3Fingerprint();
                    this.logger.debug(`使用新的JA3指纹: ${this.options.ja3Fingerprint}`);
                    
                    continue;
                }
                
                // 达到最大重试次数，抛出错误
                this.logger.error(`请求失败，达到最大重试次数: ${error.message}`);
                throw error;
            }
        }
    }
    
    /**
     * 发送GET请求
     * @param {string} url 请求URL
     * @param {Object} [headers] 请求头
     * @param {Object} [options] 请求选项
     * @returns {Promise<Object>} 响应结果
     */
    async get(url, headers = {}, options = {}) {
        return this.request('GET', url, null, headers, options);
    }
    
    /**
     * 发送POST请求
     * @param {string} url 请求URL
     * @param {Object} [data] 请求数据
     * @param {Object} [headers] 请求头
     * @param {Object} [options] 请求选项
     * @returns {Promise<Object>} 响应结果
     */
    async post(url, data = null, headers = {}, options = {}) {
        return this.request('POST', url, data, headers, options);
    }
    
    /**
     * 发送PUT请求
     * @param {string} url 请求URL
     * @param {Object} [data] 请求数据
     * @param {Object} [headers] 请求头
     * @param {Object} [options] 请求选项
     * @returns {Promise<Object>} 响应结果
     */
    async put(url, data = null, headers = {}, options = {}) {
        return this.request('PUT', url, data, headers, options);
    }
    
    /**
     * 发送DELETE请求
     * @param {string} url 请求URL
     * @param {Object} [headers] 请求头
     * @param {Object} [options] 请求选项
     * @returns {Promise<Object>} 响应结果
     */
    async delete(url, headers = {}, options = {}) {
        return this.request('DELETE', url, null, headers, options);
    }
}

module.exports = HttpClient; 
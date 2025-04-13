/**
 * 代理管理类
 * 负责加载、分配和管理代理IP
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const Logger = require('../utils/Logger');

class ProxyManager {
    /**
     * 构造函数
     */
    constructor() {
        this.dynamicProxy = null;
        this.logger = new Logger('ProxyManager');
        this.loadProxyConfig();
    }
    
    /**
     * 加载代理配置
     */
    loadProxyConfig() {
        try {
            if (!config.network.useProxy) {
                this.logger.info('代理功能已禁用，将使用直接连接');
                return;
            }
            
            // 使用动态代理
            if (config.network.useDynamicProxy) {
                this.dynamicProxy = {
                    host: config.network.proxyHost || process.env.PROXY_HOST,
                    port: config.network.proxyPort || process.env.PROXY_PORT,
                    username: config.network.proxyUsername || process.env.PROXY_USERNAME,
                    password: config.network.proxyPassword || process.env.PROXY_PASSWORD
                };
                
                if (!this.dynamicProxy.host || !this.dynamicProxy.port) {
                    this.logger.error('动态代理配置不完整，请检查代理地址和端口');
                    this.dynamicProxy = null;
                    return;
                }
                
                this.logger.info(`已配置动态代理 ${this.dynamicProxy.host}:${this.dynamicProxy.port}`);
                if (this.dynamicProxy.username && this.dynamicProxy.password) {
                    this.logger.info('代理身份验证已配置');
                }
                
                return;
            }
            
            this.logger.warn('未配置动态代理，将使用直接连接');
        } catch (error) {
            this.logger.error('加载代理配置失败:', error);
            this.dynamicProxy = null;
        }
    }
    
    /**
     * 获取动态代理
     * @returns {Object|null} 代理配置或null（如果代理未启用或无可用代理）
     */
    getDynamicProxy() {
        if (!config.network.useProxy || !this.dynamicProxy) {
            return null;
        }
        
        return this.dynamicProxy;
    }
    
    /**
     * 为账号分配代理
     * @param {Array} accounts 账号列表
     * @returns {Array} 分配了代理的账号列表
     */
    assignProxiesToAccounts(accounts) {
        const proxy = this.getDynamicProxy();
        
        if (!proxy) {
            return accounts.map(account => ({
                ...account,
                proxy: { host: null, port: null }
            }));
        }
        
        return accounts.map(account => {
            // 如果账号已有代理配置，则保留
            if (account.proxy && account.proxy.host) {
                return account;
            }
            
            // 否则分配动态代理
            return {
                ...account,
                proxy: {...proxy}
            };
        });
    }
}

module.exports = ProxyManager; 
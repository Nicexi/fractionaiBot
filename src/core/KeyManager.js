/**
 * 私钥管理器
 * 负责安全地加载、加密和解密私钥
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const Logger = require('../utils/Logger');
const config = require('../config');

class KeyManager {
    /**
     * 构造函数
     * @param {string} accountsFile 账号文件路径
     */
    constructor(accountsFile) {
        this.accountsFile = accountsFile || config.auth.privateKeyFile;
        this.accounts = [];
        this.logger = new Logger('KeyManager');
    }

    /**
     * 加载账号列表
     * @returns {Array} 账号列表
     */
    loadAccounts() {
        try {
            const accountsPath = path.resolve(this.accountsFile);
            
            if (!fs.existsSync(accountsPath)) {
                this.logger.error(`账号文件 ${this.accountsFile} 不存在`);
                throw new Error(`账号文件 ${this.accountsFile} 不存在`);
            }
            
            const accountsData = fs.readFileSync(accountsPath, 'utf8');
            
            // 每行一个私钥格式
            const accounts = accountsData.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#')) // 忽略空行和注释
                .map((privateKey, index) => ({
                    privateKey,
                    alias: `Account ${index + 1}`
                }));
            
            
            // 验证和处理账号
            this.accounts = accounts.filter(account => {
                try {
                    if (!account.privateKey.startsWith('0x')) {
                        account.privateKey = '0x' + account.privateKey;
                    }
                    
                    // 验证私钥是否有效
                    const wallet = new ethers.Wallet(account.privateKey);
                    account.address = wallet.address;
                    
                    return true;
                } catch (walletError) {
                    this.logger.error(`无效的私钥 (${account.privateKey.substring(0, 10)}...): ${walletError.message}`);
                    return false;
                }
            });
            
            return this.accounts;
        } catch (error) {
            this.logger.error('加载账号数据失败', error);
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
            // 规范化私钥
            if (privateKey && !privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            
            // 验证并获取地址
            const wallet = new ethers.Wallet(privateKey);
            return wallet.address;
        } catch (error) {
            this.logger.error(`无法从私钥获取地址: ${error.message}`);
            throw new Error(`无效的私钥: ${error.message}`);
        }
    }
    
    /**
     * 验证私钥是否有效
     * @param {string} privateKey 私钥
     * @returns {boolean} 是否有效
     */
    isValidPrivateKey(privateKey) {
        try {
            // 规范化私钥
            if (privateKey && !privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            
            // 尝试创建钱包，如果成功则有效
            new ethers.Wallet(privateKey);
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = KeyManager; 
/**
 * 以太坊签名工具
 * 提供签名和验证功能
 */
const { ethers } = require('ethers');
const Logger = require('../utils/Logger');

class EthSigner {
  /**
   * 构造函数
   * @param {string} privateKey 以太坊钱包私钥（带0x）
   */
  constructor(privateKey) {
    if (!privateKey || !privateKey.startsWith('0x')) {
      throw new Error('无效的私钥');
    }
    
    // 初始化日志记录器
    this.logger = new Logger('EthSigner');
    
    // 使用Sepolia测试网络的RPC节点
    const provider = new ethers.providers.JsonRpcProvider('https://eth-sepolia.public.blastapi.io/');
    this.logger.info('初始化以太坊钱包，使用Sepolia测试网络 (ChainId: 11155111)');
    this.logger.debug(`RPC提供者: https://eth-sepolia.public.blastapi.io/`);
    
    // 使用私钥和提供者创建钱包
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.address = this.wallet.address;
    this.provider = provider;
    
    // 打印钱包信息
    this.logger.info(`钱包初始化成功，地址: ${this.address}`);
  }

  /**
   * 签名 message
   * @param {string} message 待签名内容
   * @returns {Promise<string>} 签名结果
   */
  async signMessage(message) {
    return await this.wallet.signMessage(message);
  }

  /**
   * 验证签名是否合法
   * @param {string} message 原始内容
   * @param {string} signature 签名内容
   * @returns {boolean} 是否验证通过
   */
  verifySignature(message, signature) {
    const recoveredAddress = ethers.utils.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === this.address.toLowerCase();
  }
}

module.exports = EthSigner; 
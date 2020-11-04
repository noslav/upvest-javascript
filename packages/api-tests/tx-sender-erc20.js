//const { number } = require('bitcoinjs-lib/types/script');
const { TxSender } = require('./tx-sender.js');
// const { EthereumAndErc20Faucet } = require('./faucet.js');
// const { hexBigInt } = require('./util.js');


class TxSenderErc20 extends TxSender {
  beSpecific() {
    this.title = `ERC20`;
    this.mainTxAssetId = this.faucetCfg.erc20.assetId;
    this.mainTxAmount = BigInt(this.faucetCfg.erc20.amount);
    this.gasLimitByteCode = BigInt(this.faucetCfg.erc20.gasLimit);
    this.faucetMethod = `faucetErc20`;
    this.Ethtitle = `Eth`;
    this.faucetEthMethod = `faucetEth`;
    this.ethAmount = BigInt(this.faucetCfg.eth.amount);
  }
}
module.exports = { TxSenderErc20 };

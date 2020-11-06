const { TxSender } = require('./tx-sender.js');


class TxSenderEth extends TxSender {
  beSpecific() {
    this.title = `ETH`;
    this.mainTxAssetId = this.faucetCfg.eth.assetId;
    this.mainTxAmount = BigInt(this.faucetCfg.eth.transfer);
    this.gasLimitByteCode = 0n;
    this.faucetMethod = 'faucetEth';
    this.Ethtitle = `Eth`;
    this.faucetEthMethod = `faucetEth`;
    this.ethAmount = BigInt(this.faucetCfg.eth.amount);
  }
}

module.exports = { TxSenderEth };

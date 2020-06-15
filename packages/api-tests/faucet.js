const { toBN } = require('web3-utils');
const EthereumTx = require('ethereumjs-tx').Transaction;

const erc20ABI = require('./erc20-abi.json');
const minimalTransferABI = erc20ABI.filter(abi => (abi.type == 'function') && (abi.name == 'transfer'))[0];

const web3Pool = require('./web3-pool.js');

const {
  inspect, getTxEtherscanUrl,
} = require('./util.js');

const { EthGasStation } = require('./ethgasstation.js');

const egs = new EthGasStation();

function ensureHexPrefix(hexString) {
  return (hexString.substr(0, 2) === '0x') ? hexString : '0x' + hexString;
}

function un0x(hexString) {
  return hexString.replace(/^0[xX]/, '');
}


async function prepareTxSendEther(web3, sender, recipient, amount, gasPrice=3.5e9, nonce=null) {
  const GAS_LIMIT_ETH_TRANSFER = 21000;
  const gasLimit = toBN(GAS_LIMIT_ETH_TRANSFER);
  gasPrice = toBN(gasPrice);
  const gasCost = gasLimit.mul(gasPrice);

  if (nonce) {
    inspect(`prepareTxSendEther nonce == ${nonce.toString(10)}`);
  }
  if (! nonce) {
    nonce = await web3.eth.getTransactionCount(sender);
  }
  const balance = toBN(await web3.eth.getBalance(sender));

  amount = toBN(amount);

  if (balance.lt(amount.add(gasCost))) {
    throw Error('Insufficient funds.');
  }

  return {
    value: ensureHexPrefix(toBN(amount).toString(16)),
    to: ensureHexPrefix(recipient),
    nonce: ensureHexPrefix(toBN(nonce).toString(16)),
    gasLimit: ensureHexPrefix(gasLimit.toString(16)),
    gasPrice: ensureHexPrefix(gasPrice.toString(16)),
  };
}

async function prepareTxTransferErc20(web3, contract, sender, recipient, amount, gasPrice=3.5e9, gasLimit=51241, nonce=null) {
  const transferCall = web3.eth.abi.encodeFunctionCall(minimalTransferABI, [recipient, toBN(amount).toString(10)]);
  if (nonce) {
    inspect(`prepareTxTransferErc20 nonce == ${nonce.toString(10)}`);
  }
  if (! nonce) {
    nonce = await web3.eth.getTransactionCount(sender);
  }
  return {
    data: transferCall,
    to: ensureHexPrefix(contract),
    nonce: ensureHexPrefix(toBN(nonce).toString(16)),
    gasLimit: ensureHexPrefix(gasLimit.toString(16)),
    gasPrice: ensureHexPrefix(gasPrice.toString(16)),
  };
}

function sendTx(web3, rawTransaction, confirmationThreshold, netName, logger) {
  if (! logger) logger = msg => undefined;
  return new Promise(function promiseExecutor(resolvePromise, rejectPromise) {
    let rejectionReceipt = null;
    let removeTxListeners;

    const txPromise = web3.eth.sendSignedTransaction(rawTransaction);

    txPromise.once('transactionHash', transactionHash => logger(getTxEtherscanUrl(`ethereum_${netName}`, transactionHash)));
    txPromise.once('receipt', receipt => logger(`receipt = ${JSON.stringify(receipt, null, 2)}`));

    const txConfirmationListener = function(confirmationNumber, receipt) {
      logger(`confirmation number: ${confirmationNumber}`);
      if (! receipt.status) {
        rejectionReceipt = receipt;
      }

      if (Number(confirmationNumber) >= confirmationThreshold) {
        const transactionHash = receipt.transactionHash;
        const transactionStatus = receipt.status;
        const transactionReceipt = receipt;

        removeTxListeners();
        resolvePromise({
          success: true,
          confirmationNumber,
          transactionHash,
          transactionStatus,
          transactionReceipt,
        });
      }
      else {
        // Keep listening for more confirmations.
        txPromise.once('confirmation', txConfirmationListener);
      }
    };
    txPromise.once('confirmation', txConfirmationListener);

    const txErrorListener = function(error) {
      // removeTxListeners();
      rejectPromise({success: false, error, rejectionReceipt});
    }
    txPromise.once('error', txErrorListener);

    // txPromise.then(removeTxListeners); // This is triggered by the receipt, before we receive additional confirmations (???)
    txPromise.catch(removeTxListeners);
    txPromise.finally(removeTxListeners);

    removeTxListeners = function() {
      txPromise.off('confirmation', txConfirmationListener);
      txPromise.off('error', txErrorListener);
      if (txPromise.removeAllListeners) {
        txPromise.removeAllListeners(); // `.removeAllListeners()` is not documented at https://web3js.readthedocs.io/en/1.0/callbacks-promises-events.html
      }
    };
  });
}


class EthereumAndErc20Faucet {
  constructor(config) {
    this.config = config;
    this.currentNonce = toBN(0);
  }

  get web3() {
    return web3Pool.getWeb3(this.config.infuraProjectId, this.config.netName);
  }

  async syncCurrentNonceFromBlockChain() {
    const blockChainNonce = toBN(await this.web3.eth.getTransactionCount(this.config.holder.address));
    if (blockChainNonce.gt(this.currentNonce)) {
      this.currentNonce = blockChainNonce;
    }
    return this.currentNonce;
  }

  async getCurrentNonce() {
    // Just in case we forgot to sync up before use.
    if (toBN(0).eq(this.currentNonce)) {
      await this.syncCurrentNonceFromBlockChain();
    }
    return this.currentNonce;
  }

  incrementCurrentNonce() {
    this.currentNonce = this.currentNonce.add(toBN(1));
    return this.currentNonce;
  }

  async signAndSend(txParams, logger) {
    if (! logger) logger = msg => undefined;
    const privateKey = Buffer.from(un0x(this.config.holder.key), 'hex');

    const tx = new EthereumTx(txParams, { chain: this.config.netName, hardfork: 'petersburg' });
    tx.sign(privateKey);
    const serializedTx = tx.serialize();

    try {
      return await sendTx(this.web3, ensureHexPrefix(serializedTx.toString('hex')), this.config.confirmationThreshold, this.config.netName, logger);
    }
    catch (error) {
      // TODO Re-think error handling.
      return error;
    }
  }

  async faucetEth(recipient, amount, logger) {
    const txSendEther = await prepareTxSendEther(
      this.web3,
      this.config.holder.address,
      recipient,
      toBN(amount),
      (await egs.getGasPrice(24)).min,
      await this.getCurrentNonce()
    );
    return await this.signAndSend(txSendEther, logger);
  }

  async faucetErc20(recipient, amount, logger) {
    const txTransferErc20 = await prepareTxTransferErc20(
      this.web3,
      this.config.erc20.contract,
      this.config.holder.address,
      recipient,
      toBN(amount),
      (await egs.getGasPrice(24)).min,
      this.config.erc20.gasLimit,
      await this.getCurrentNonce()
    );
    return await this.signAndSend(txTransferErc20, logger);
  }

  async run(recipient, ethAmount, erc20Amount, logger) {
    if (! logger) logger = msg => undefined;

    await this.syncCurrentNonceFromBlockChain();

    const faucets = [];

    if (toBN(ethAmount).gt(toBN(0))) {
      faucets.push(this.faucetEth(recipient, ethAmount, msg => logger(`ETH faucet: ${msg}`)));
      this.incrementCurrentNonce(); // Increment "by hand" since we are about to send multiple transactions into the same pending block.
    }

    if (toBN(erc20Amount).gt(toBN(0))) {
      faucets.push(this.faucetErc20(recipient, erc20Amount, msg => logger(`ERC20 faucet: ${msg}`)));
      this.incrementCurrentNonce(); // Increment "by hand" since we are about to send multiple transactions into the same pending block.
    }

    return await Promise.all(faucets);
  }

  // Without disconnecting, the web socket connection will keep the Node.js process running beyond test completion.
  disconnect() {
    web3Pool.disconnectAll();
  }
}


module.exports = { EthereumAndErc20Faucet };

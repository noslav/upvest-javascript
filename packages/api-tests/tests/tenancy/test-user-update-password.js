const crypto = require('crypto');

const testenv = require('../../testenv.js');
const partials = require('../../partials.js');

// Shortcuts to most-used facilities.
const { test, inspect } = testenv;


test('Testing users.updatePassword()', async function (t) {
  let echoSuccess;
  const clientIp = '127.0.0.1';
  const userAgent = 'Upvest JS API client test script';
  const assetIds = Object.values(testenv.config.assetIds);
  const { username, password, recoverykit, wallet_ids } = await partials.tCreateUser(t, testenv.tenancy, clientIp, userAgent, assetIds);
  if (! username) return;

  t.comment('See if OAuth2 with original password works.');
  echoSuccess = await partials.tEcho(t, testenv.getClienteleAPI(username, password));
  if (! echoSuccess) return;

  webhookRecording = await testenv.getWebhookRecording();

  const newPassword = testenv.cryptoRandomString(10);

  let isUpdated;
  try {
    isUpdated = await testenv.tenancy.users.updatePassword(username, password, newPassword);
  }
  catch (error) {
    return partials.tErrorFail(t, error, 'Updating the password failed.');
  }
  t.ok(isUpdated, 'The user password was updated.');

  for (const walletId of wallet_ids) {
    webhookRecording.addMatcher((body, simpleHeaders, rawHeaders, metaData) => {
      const webhookPayload = JSON.parse(body);
      if (webhookPayload.data.username != username) {
        // We do not match other test run's webhooks.
        return false;
      }

      if (webhookPayload.data.id != walletId) {
        // This is not the webhook this matcher is looking for.
        return false;
      }

      t.equal(webhookPayload.action, 'wallet.recrypted', 'Webhook action is "wallet.recrypted"');

      const signatureHeader = simpleHeaders['X-Up-Signature'];
      t.ok(signatureHeader, 'Found webhook HMAC signature header');
      const hmac = crypto.createHmac('sha256', testenv.config.webhook.hmacKey).update(body, 'utf8').digest('hex');
      t.equal(signatureHeader, 'sha256=' + hmac, 'Webhook HMAC signature matches');

      t.notEqual(webhookPayload.data.address.length, 0, `Received webhook with wallet address for Wallet ID ${walletId}.`);

      return true;
    });
  }

  try {
    t.comment('Waiting for all expected webhooks to be called.')
    const areAllExpectedWebhooksCalled = await webhookRecording.areAllMatched(3 * 60 * 1000);
    t.ok(areAllExpectedWebhooksCalled, 'All expected webhooks were called');
  }
  catch (err) {
    inspect(err);
    t.fail('Timed out while waiting for all expected webhooks to be called');
  }

  webhookRecording.stop();

  const newClientele = testenv.getClienteleAPI(username, newPassword);

  // In case no webhook setup is configured.
  await partials.tWaitForWalletActivation(t, newClientele);

  try {
    echo = await testenv.getClienteleAPI(username, password).echo('all good');
    t.fail('OAuth2 with original password should have failed, but did not.');
  }
  catch (error) {
    t.equal(error.response.status, 401, 'OAuth2 with original password fails with status 401.');
    t.equal(error.response.data.error, 'invalid_grant', 'OAuth2 with original password fails with error code "invalid_grant".');
  }

  t.comment('See if OAuth2 with new password works.');
  echoSuccess = await partials.tEcho(t, newClientele);
  if (! echoSuccess) return;

  t.comment('Test signing with new password.');
  let signCount = 0;
  for (const walletId of wallet_ids) {
    const wallet = await newClientele.wallets.retrieve(walletId);

    inspect(wallet);

    // Only test Tx creation for ETH and ERC20.
    const protocolNamesToTestWith = [
      'ethereum', 'erc20',
      'ethereum_ropsten', 'erc20_ropsten',
      'ethereum_kovan', 'erc20_kovan',
    ];
    if (-1 === protocolNamesToTestWith.indexOf(wallet.protocol)) {
      continue;
    }

    await partials.tEthereumSigning(t, newClientele, wallet, newPassword);
    signCount++;
  }

  t.ok(signCount > 0, 'At least one signature was tested.');


  t.end();
});

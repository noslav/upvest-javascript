const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);

const { createInterface } = require('readline');

const cryptoRandomString = require('crypto-random-string');

function setDifference(setA, setB) {
  const _difference = new Set(setA);
  for (const elem of setB) {
    _difference.delete(elem);
  }
  return _difference;
}

function setEqual(setA, setB) {
  return (
    (setDifference(setA, setB).size == 0)
    &&
    (setDifference(setB, setA).size == 0)
  );
}

const inspect = (...things) => things.forEach(thing => console.dir(thing, {depth:null, colors:true}));

const inspectResponse = response => {
  const isTextResponse = ('string' == typeof response.data);
  const summary = {
    request: {
      method: response.config.method,
      url: response.config.url,
      queryParams: response.config.params,
      headers: response.config.headers,
      jsonBody: response.config.data,
    },
    response: {
      status: response.status,
      reason: response.statusText,
      headers: response.headers,
      jsonBody: isTextResponse ? '[see printed response text below]' : response.data,
    },
  }
  inspect(summary);
  if (isTextResponse) {
    console.log(response.data);
  }
};

const inspectError = error => {
  if (error.response) {
    inspectResponse(error.response);
  }
  else {
    inspect(error);
  }
};

const tErrorFail = (t, error, message) => {
  inspectError(error);
  t.fail(message);
  t.end();
  return false;
};

const tGetCachedOrCreateUser = async (t, tenancy) => {
  if (! tenancy._cachedUser) {
    tenancy._cachedUser = tCreateUser(t, tenancy);
  }
  else {
    t.comment('Re-use cached user.')
  }
  return tenancy._cachedUser;
};

const tCreateUser = async (t, tenancy, clientIp, userAgent, assetIds) => {
  t.comment('Create user.')
  const username = cryptoRandomString(10);
  const password = cryptoRandomString(10);
  let user;
  try {
    user = await tenancy.users.create(username, password, clientIp, userAgent, assetIds);
  }
  catch (error) {
    tErrorFail(t, error, 'Creating the user failed.');
    return { username:null, password:null, recoverykit:null, wallet_ids:null };
  }

  t.equal(user.username, username, 'Actual and expected username are equal');

  user.password = password;
  return user;
};

const tEcho = async (t, api) => {
  const shouts = [
    'Hello',
    'Hello, world!',
    'Hello, world & peace = mindfulness!',
    'Ωμέγα',
    'ǈiljana',
    '陳大文',
  ];
  for (const shout of shouts) {
    let echoPost;
    try {
      echoPost = await api.echo(shout);
    }
    catch (error) {
      return tErrorFail(t, error, 'Failed to call echo endpoint. (Or, if this was run via OAuth2, it might also mean that obtaining the OAuth2 token failed.)');
    }
    t.equal(echoPost, shout, `Actual and expected echo are equal (POST "${shout}")`);

    let echoGet;
    try {
      echoGet = await api.echoGet(shout);
    }
    catch (error) {
      return tErrorFail(t, error, 'Failed to call echo endpoint. (Or, if this was run via OAuth2, it might also mean that obtaining the OAuth2 token failed.)');
    }
    t.equal(echoGet, shout, `Actual and expected echo are equal (GET "${shout}")`);
  }
  return true;
};

const tCreateWallets = async (t, api, assetIds, password) => {
  t.comment(`Create wallets for ${assetIds.length} assets.`)
  let createdWallets = [];
  for (const assetId of assetIds) {
    let wallet;
    try {
      wallet = await api.wallets.create(assetId, password, null);
    }
    catch (error) {
      return tErrorFail(t, error, `Creating the wallet for assetId ${assetId} failed.`);
    }
    // t.comment('Inspecting created wallet:');
    // inspect(wallet);
    let createdAssetIds = [];
    for (const balance of wallet.balances) {
      createdAssetIds.push(balance.asset_id);
    }
    t.ok(-1 !== createdAssetIds.indexOf(assetId), 'Created wallet contains balance for requested asset.');
    createdWallets.push(wallet);
  }
  return createdWallets;
};

const tWaitForWalletActivation = async (t, api) => {
  t.comment('Wait for wallet activation.')
  // Poll user's wallets to see when seed generation has finished. Prefer
  // polling over the API Key callback, because this test script might run in
  // places which are not able to receive callbacks.
  const MAX_RETRIES = 3 * 60;
  let isGenSeedFinished;
  let retries = 0;
  do {
    isGenSeedFinished = true;
    for await (const wallet of api.wallets.list()) {
      t.comment(`Waited ${retries} seconds.`);
      // inspect(wallet);
      if (wallet.status != 'ACTIVE' || wallet.address === null) {
        isGenSeedFinished = false;
        break;
      }
    }
    if (! isGenSeedFinished) {
      // Sleep for a second, then try again.
      await setTimeoutPromise(1000);
    }
    retries++;
  }
  while (! isGenSeedFinished && retries < MAX_RETRIES);
  t.ok(retries < MAX_RETRIES, `Waited less than ${MAX_RETRIES} seconds for seed generation.`);

  const GRACE_PERIOD = Math.min(10, (retries - 1));
  t.comment(`Waiting for an additional grace period of ${GRACE_PERIOD} seconds.`)
  await setTimeoutPromise(GRACE_PERIOD * 1000);
};

function readlineQuestionPromise(prompt) {
  return new Promise(function promiseExecutor(resolvePromise, rejectPromise) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(
      prompt,
      answer => {
        rl.close();
        resolvePromise(answer);
      }
    );
  });
}


module.exports = {
  setDifference, setEqual, inspect, inspectResponse, inspectError,
  tErrorFail, tGetCachedOrCreateUser, tCreateUser, tEcho,
  tCreateWallets, tWaitForWalletActivation,
  readlineQuestionPromise
};

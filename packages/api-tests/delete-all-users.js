const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);

const xmlParser = require('fast-xml-parser');

const { UpvestTenancyAPI } = require('@upvest/tenancy-api');

const { inspect, inspectError } = require('./util.js');

const { test_config, forced } = require('./cli-options.js');

const tenancy = new UpvestTenancyAPI(
  test_config.baseURL,
  test_config.first_apikey.key,
  test_config.first_apikey.secret,
  test_config.first_apikey.passphrase_last_chance_to_see,
);

async function deleteAllUsers() {
  if (! forced) {
    inspect('Please use the --force command line switch to delete all users.');
    return;
  }
  for await (const user of tenancy.users.list()) {
    if (user.username.startsWith('txtest-')) {
      // Skip users for whom funds might have gotten stuck in a failed transaction
      continue;
    }

    let isDeleted;
    try {
      isDeleted = await tenancy.users.delete(user.username);
    }
    catch (error) {
      inspect('Deleting the user failed.');
      inspectError(error);
    }
    inspect('The user was deleted:', isDeleted);
  }
}

deleteAllUsers();

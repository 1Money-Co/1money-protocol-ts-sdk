// Examples of using the 1money testnet API

const { api } = require('../src/api');

// Initialize the API client
const apiClient = api();

// Example addresses and values - replace with valid values for testing
const testAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
const testRecipient = '0x6324dAc598f9B637824978eD6b268C896E0c40E0';
const testToken = '0x2cd8999Be299373D7881f4aDD11510030ad1412F';
const testHash = '0xf55f9525be94633b56f954d3252d52b8ef42f5fd5f9491b243708471c15cc40c';
const testValue = '1000000000';

// Example 1: Get checkpoint number
console.log('Example 1: Get checkpoint number');
apiClient.checkpoints.getNumber()
  .success(response => {
    console.log('Current checkpoint number:', response.number);
    console.log('---');
    
    // Example 2: Get checkpoint by number
    console.log('Example 2: Get checkpoint by number');
    apiClient.checkpoints.getByNumber(response.number, false)
      .success(checkpoint => {
        console.log('Checkpoint:', checkpoint);
        console.log('---');
      })
      .error(err => {
        console.error('Error fetching checkpoint by number:', err);
      });
  })
  .error(err => {
    console.error('Error fetching checkpoint number:', err);
  });

// Example 3: Get account nonce
console.log('Example 3: Get account nonce');
apiClient.accounts.getNonce(testAddress)
  .success(response => {
    console.log('Account nonce:', response);
    console.log('---');
  })
  .error(err => {
    console.error('Error fetching account nonce:', err);
  });

// Example 4: Get token metadata
console.log('Example 4: Get token metadata');
apiClient.tokens.getTokenMetadata(testToken)
  .success(response => {
    console.log('Token metadata:', response);
    console.log('---');
  })
  .error(err => {
    console.error('Error fetching token metadata:', err);
  });

// Example 5: Estimate transaction fee
console.log('Example 5: Estimate transaction fee');
apiClient.transactions.estimateFee(testAddress, testRecipient, testValue, testToken)
  .success(response => {
    console.log('Estimated fee:', response);
    console.log('---');
  })
  .error(err => {
    console.error('Error estimating fee:', err);
  });

// Example 6: Get transaction by hash
console.log('Example 6: Get transaction by hash');
apiClient.transactions.getByHash(testHash)
  .success(response => {
    console.log('Transaction:', response);
    console.log('---');
  })
  .error(err => {
    console.error('Error fetching transaction:', err);
  });

// Note: The following examples require signing transactions and are shown for reference only

/*
// Example 7: Submit payment transaction
const paymentPayload = {
  chain_id: 1,
  nonce: 1,
  recipient: '0x...',
  value: '1000000',
  token: '0x...',
  signature: {
    r: '0x...',
    s: '0x...',
    v: 28
  }
};

apiClient.transactions.payment(paymentPayload)
  .success(response => {
    console.log('Payment transaction hash:', response);
  })
  .error(err => {
    console.error('Error submitting payment:', err);
  });

// Example 8: Issue new token
const issuePayload = {
  chain_id: 1,
  nonce: 1,
  symbol: 'TEST',
  name: 'Test Token',
  decimals: 18,
  master_authority: '0x...',
  is_private: false,
  clawback_enabled: true,
  signature: {
    r: '0x...',
    s: '0x...',
    v: 28
  }
};

apiClient.tokens.issueToken(issuePayload)
  .success(response => {
    console.log('Token issued:', response);
  })
  .error(err => {
    console.error('Error issuing token:', err);
  });
*/

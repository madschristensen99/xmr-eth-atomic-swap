// Swap functionality for the frontend
// Using global constants SWAP_CREATOR_ADDRESS and SWAP_CREATOR_ABI

// Server URL for API calls
const SERVER_URL = 'http://localhost:5000';
const PRICE_API_URL = 'https://api.coingecko.com/api/v3';

// Cache for exchange rates
const exchangeRateCache = {
  xmrToUsdc: null,
  lastUpdated: 0
};

// Fetch current XMR to USDC exchange rate
async function fetchExchangeRate() {
  try {
    // Check if we have a cached rate that's less than 5 minutes old
    const now = Date.now();
    if (exchangeRateCache.xmrToUsdc && now - exchangeRateCache.lastUpdated < 5 * 60 * 1000) {
      console.log('Using cached exchange rate:', exchangeRateCache.xmrToUsdc);
      return exchangeRateCache.xmrToUsdc;
    }
    
    // Fetch current prices from CoinGecko
    const response = await fetch(`${PRICE_API_URL}/simple/price?ids=monero&vs_currencies=usd`);
    const data = await response.json();
    
    // Update cache
    exchangeRateCache.xmrToUsdc = data.monero.usd;
    exchangeRateCache.lastUpdated = now;
    
    console.log('Fetched new exchange rate:', exchangeRateCache.xmrToUsdc);
    return exchangeRateCache.xmrToUsdc;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    // Return last known rate or a fallback value
    return exchangeRateCache.xmrToUsdc || 150; // Fallback value
  }
}

// Convert between XMR and USDC based on current rate
async function convertCurrency(amount, fromCurrency, toCurrency) {
  if (!amount || isNaN(amount)) return '0';
  
  const rate = await fetchExchangeRate();
  const amountNum = parseFloat(amount);
  
  if (fromCurrency === 'XMR' && toCurrency === 'USDC') {
    // XMR to USDC: multiply by rate
    return (amountNum * rate).toFixed(2);
  } else if (fromCurrency === 'USDC' && toCurrency === 'XMR') {
    // USDC to XMR: divide by rate
    return (amountNum / rate).toFixed(6);
  }
  
  return amount; // No conversion needed
}

// Connect to MetaMask
async function connectWallet() {
  if (window.ethereum) {
    try {
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      
      console.log('Connected to wallet:', accounts[0]);
      
      return { provider, signer, address: accounts[0] };
    } catch (error) {
      console.error('User denied account access', error);
      throw error;
    }
  } else {
    console.error('MetaMask not detected');
    throw new Error('Please install MetaMask to use this application');
  }
}

// USDC to XMR Swap Flow
async function initiateUsdcToXmrSwap(xmrAddress, usdcAmount) {
  try {
    // Step 1: Connect to wallet
    const { signer, address } = await connectWallet();
    
    // Step 2: Prepare swap parameters with the backend
    const prepareResponse = await fetch(`${SERVER_URL}/api/web3/prepare-usdc-to-xmr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evmAddress: address,
        xmrAddress: xmrAddress,
        value: usdcAmount // In atomic units (e.g., 10000 for 0.01 USDC)
      })
    });
    
    const prepareResult = await prepareResponse.json();
    console.log('Swap parameters prepared:', prepareResult);
    
    // Step 3: Approve USDC spending
    // Get USDC contract instance
    const usdcContract = new ethers.Contract(
      prepareResult.swapParams.asset, // USDC address
      ['function approve(address spender, uint256 amount) public returns (bool)'],
      signer
    );
    
    // Approve the swap contract to spend USDC
    const approveTx = await usdcContract.approve(
      SWAP_CREATOR_ADDRESS,
      prepareResult.swapParams.value
    );
    
    console.log('Approval transaction submitted:', approveTx.hash);
    await approveTx.wait();
    console.log('Approval confirmed');
    
    // Step 4: Create the swap on the contract
    const swapContract = new ethers.Contract(
      SWAP_CREATOR_ADDRESS,
      SWAP_CREATOR_ABI,
      signer
    );
    
    // Create the swap
    const createSwapTx = await swapContract.newSwap(
      prepareResult.swapParams.claimCommitment,
      prepareResult.swapParams.refundCommitment,
      prepareResult.swapParams.claimer,
      prepareResult.swapParams.timeout1,
      prepareResult.swapParams.timeout2,
      prepareResult.swapParams.asset,
      prepareResult.swapParams.value,
      prepareResult.swapParams.nonce
    );
    
    console.log('Swap creation transaction submitted:', createSwapTx.hash);
    await createSwapTx.wait();
    console.log('Swap created on the blockchain');
    
    // Step 5: Notify backend of swap creation
    const notifyResponse = await fetch(`${SERVER_URL}/api/web3/notify-usdc-to-xmr-created`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        swapId: prepareResult.swapId,
        txHash: createSwapTx.hash
      })
    });
    
    const notifyResult = await notifyResponse.json();
    console.log('Backend notified of swap creation:', notifyResult);
    
    // Step 6: Set the swap as ready
    const swapObj = [
      prepareResult.swapParams.owner,
      prepareResult.swapParams.claimer,
      prepareResult.swapParams.claimCommitment,
      prepareResult.swapParams.refundCommitment,
      prepareResult.swapParams.timeout1,
      prepareResult.swapParams.timeout2,
      prepareResult.swapParams.asset,
      prepareResult.swapParams.value,
      prepareResult.swapParams.nonce
    ];
    
    const setReadyTx = await swapContract.setReady(swapObj);
    console.log('SetReady transaction submitted:', setReadyTx.hash);
    await setReadyTx.wait();
    console.log('Swap set as ready on the blockchain');
    
    // Step 7: Notify backend that swap is ready for XMR sending
    const readyResponse = await fetch(`${SERVER_URL}/api/web3/notify-usdc-to-xmr-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        swapId: prepareResult.swapId
      })
    });
    
    const readyResult = await readyResponse.json();
    console.log('Backend notified of ready state:', readyResult);
    
    // Step 8: Poll for status updates
    pollSwapStatus(prepareResult.swapId);
    
    return prepareResult.swapId;
  } catch (error) {
    console.error('Error initiating USDC to XMR swap:', error);
    throw error;
  }
}

// XMR to USDC Swap Flow
async function initiateXmrToUsdcSwap(xmrAmount, usdcAmount) {
  try {
    // Step 1: Connect to wallet
    const { signer, address } = await connectWallet();
    
    // Step 2: Prepare swap parameters with the backend
    const prepareResponse = await fetch(`${SERVER_URL}/api/web3/prepare-xmr-to-usdc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evmAddress: address,
        value: usdcAmount, // In atomic units (e.g., 10000 for 0.01 USDC)
        xmrAmount: xmrAmount // As a string (e.g., "0.001")
      })
    });
    
    const prepareResult = await prepareResponse.json();
    console.log('Swap parameters prepared:', prepareResult);
    
    // Step 3: Send XMR (backend operation)
    const sendXmrResponse = await fetch(`${SERVER_URL}/api/web3/xmr-to-usdc/${prepareResult.swapId}/send-xmr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    const sendXmrResult = await sendXmrResponse.json();
    console.log('XMR sent:', sendXmrResult);
    
    // Step 4: Create EVM swap
    const swapContract = new ethers.Contract(
      SWAP_CREATOR_ADDRESS,
      SWAP_CREATOR_ABI,
      signer
    );
    
    // Generate swap parameters
    const now = Math.floor(Date.now() / 1000);
    const timeout1 = now + 3600; // 1 hour
    const timeout2 = now + 7200; // 2 hours
    
    // Create the swap
    const createSwapTx = await swapContract.newSwap(
      prepareResult.claimCommitment,
      prepareResult.refundCommitment,
      address, // Self-swap for testing
      timeout1,
      timeout2,
      '0x0000000000000000000000000000000000000000', // Native currency (ETH/BNB)
      ethers.utils.parseEther(usdcAmount), // Convert to wei
      Math.floor(Math.random() * 1000000) // Random nonce
    );
    
    console.log('Swap creation transaction submitted:', createSwapTx.hash);
    await createSwapTx.wait();
    console.log('Swap created on the blockchain');
    
    // Step 5: Notify backend of EVM swap creation
    const notifyResponse = await fetch(`${SERVER_URL}/api/web3/notify-xmr-to-usdc-created`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        swapId: prepareResult.swapId,
        txHash: createSwapTx.hash
      })
    });
    
    const notifyResult = await notifyResponse.json();
    console.log('Backend notified of swap creation:', notifyResult);
    
    // Poll for status updates
    pollSwapStatus(prepareResult.swapId);
    
    return prepareResult.swapId;
  } catch (error) {
    console.error('Error initiating XMR to USDC swap:', error);
    throw error;
  }
}

// Poll for swap status updates
async function pollSwapStatus(swapId) {
  const statusInterval = setInterval(async () => {
    try {
      const statusResponse = await fetch(`${SERVER_URL}/api/web3/status/${swapId}`);
      const statusResult = await statusResponse.json();
      
      console.log('Current swap status:', statusResult);
      
      if (statusResult.status === 'COMPLETED') {
        console.log('Swap completed successfully!');
        clearInterval(statusInterval);
      }
    } catch (error) {
      console.error('Error polling swap status:', error);
    }
  }, 5000); // Poll every 5 seconds
  
  // Stop polling after 10 minutes to prevent infinite polling
  setTimeout(() => {
    clearInterval(statusInterval);
    console.log('Status polling stopped after timeout');
  }, 10 * 60 * 1000);
}

// Event listeners for UI
document.addEventListener('DOMContentLoaded', () => {
  // Connect wallet button
  const connectWalletBtn = document.getElementById('connectWalletBtn');
  if (connectWalletBtn) {
    connectWalletBtn.addEventListener('click', async () => {
      try {
        const { address } = await connectWallet();
        connectWalletBtn.textContent = address.substring(0, 6) + '...' + address.substring(address.length - 4);
        connectWalletBtn.classList.add('connected');
      } catch (error) {
        console.error('Failed to connect wallet:', error);
        alert(`Failed to connect wallet: ${error.message}`);
      }
    });
  }
  
  // Exchange rate display
  const exchangeRateDisplay = document.getElementById('exchangeRate');
  if (exchangeRateDisplay) {
    const updateExchangeRateDisplay = async () => {
      try {
        const rate = await fetchExchangeRate();
        exchangeRateDisplay.textContent = `1 XMR ≈ ${rate.toFixed(2)} USDC`;
      } catch (error) {
        console.error('Failed to update exchange rate display:', error);
      }
    };
    
    updateExchangeRateDisplay();
    setInterval(updateExchangeRateDisplay, 60000); // Update every minute
  }
  
  // Create swap button
  const createSwapBtn = document.getElementById('createSwapBtn');
  if (createSwapBtn) {
    createSwapBtn.addEventListener('click', async () => {
      try {
        const sendCurrency = document.getElementById('sendCurrency').innerText.trim();
        const sendAmount = document.getElementById('sendAmount').value;
        const receiveCurrency = document.getElementById('receiveCurrency').innerText.trim();
        const receiveAmount = document.getElementById('receiveAmount').value;
        const receiverAddress = document.getElementById('receiverAddress').value;
        
        if (!sendAmount || !receiveAmount) {
          alert('Please enter both send and receive amounts');
          return;
        }
        
        if (sendCurrency === 'USDC' && receiveCurrency === 'XMR') {
          if (!receiverAddress) {
            alert('Please enter your XMR wallet address');
            return;
          }
          
          // Convert USDC to atomic units (6 decimals)
          const usdcAtomicUnits = Math.floor(parseFloat(sendAmount) * 1e6).toString();
          
          const swapId = await initiateUsdcToXmrSwap(receiverAddress, usdcAtomicUnits);
          alert(`USDC to XMR swap initiated with ID: ${swapId}`);
        } else if (sendCurrency === 'XMR' && receiveCurrency === 'USDC') {
          // Convert USDC to atomic units (6 decimals)
          const usdcAtomicUnits = Math.floor(parseFloat(receiveAmount) * 1e6).toString();
          
          const swapId = await initiateXmrToUsdcSwap(sendAmount, usdcAtomicUnits);
          alert(`XMR to USDC swap initiated with ID: ${swapId}`);
        } else {
          alert('Unsupported currency pair');
        }
      } catch (error) {
        alert(`Failed to create swap: ${error.message}`);
      }
    });
  }
  
  // Swap direction button
  const swapDirectionBtn = document.getElementById('swapDirection');
  if (swapDirectionBtn) {
    swapDirectionBtn.addEventListener('click', () => {
      const sendCurrency = document.getElementById('sendCurrency');
      const receiveCurrency = document.getElementById('receiveCurrency');
      const sendAmount = document.getElementById('sendAmount');
      const receiveAmount = document.getElementById('receiveAmount');
      
      // Swap currencies
      const tempCurrency = sendCurrency.innerHTML;
      sendCurrency.innerHTML = receiveCurrency.innerHTML;
      receiveCurrency.innerHTML = tempCurrency;
      
      // Swap amounts
      const tempAmount = sendAmount.value;
      sendAmount.value = receiveAmount.value;
      receiveAmount.value = tempAmount;
      
      // Show/hide XMR address field based on receive currency
      const receiverAddressField = document.querySelector('.swap-step:nth-child(2)');
      if (receiveCurrency.innerText.includes('XMR')) {
        receiverAddressField.style.display = 'block';
      } else {
        receiverAddressField.style.display = 'none';
      }
    });
  }
  
  // Auto-convert amounts when input changes
  // Reuse existing variables instead of redeclaring them
  
  if (sendAmount && receiveAmount) {
    sendAmount.addEventListener('input', async () => {
      if (sendAmount.value) {
        const fromCurrency = sendCurrency.innerText.trim();
        const toCurrency = receiveCurrency.innerText.trim();
        receiveAmount.value = await convertCurrency(sendAmount.value, fromCurrency, toCurrency);
      } else {
        receiveAmount.value = '';
      }
    });
    
    receiveAmount.addEventListener('input', async () => {
      if (receiveAmount.value) {
        const fromCurrency = receiveCurrency.innerText.trim();
        const toCurrency = sendCurrency.innerText.trim();
        sendAmount.value = await convertCurrency(receiveAmount.value, fromCurrency, toCurrency);
      } else {
        sendAmount.value = '';
      }
    });
  }
  
  // Initialize UI
  const receiveCurrency = document.getElementById('receiveCurrency');
  if (receiveCurrency && receiveCurrency.innerText.includes('XMR')) {
    const receiverAddressField = document.querySelector('.swap-step:nth-child(2)');
    if (receiverAddressField) {
      receiverAddressField.style.display = 'block';
    }
  }
});

// Make functions globally available
// These functions are already defined in this file and will be accessible globally
// No need for export statements in regular JavaScript

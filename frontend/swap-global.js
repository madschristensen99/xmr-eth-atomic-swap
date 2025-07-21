// Swap functionality for the frontend - global version

// Server URL for API calls
const SERVER_URL = 'http://localhost:5000';

// Price API URL for fetching exchange rates
const PRICE_API_URL = 'https://api.coingecko.com/api/v3';

// Cache for exchange rates
let exchangeRateCache = {
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
    
    if (!data.monero || !data.monero.usd) {
      throw new Error('Failed to fetch Monero price');
    }
    
    // XMR to USD rate
    const xmrToUsd = data.monero.usd;
    
    // Assuming 1 USDC = 1 USD (approximately)
    const xmrToUsdc = xmrToUsd;
    
    // Update cache
    exchangeRateCache = {
      xmrToUsdc,
      lastUpdated: now
    };
    
    console.log('Fetched new exchange rate:', xmrToUsdc);
    return xmrToUsdc;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    // Return a fallback rate if we have one cached, otherwise use a default
    return exchangeRateCache.xmrToUsdc || 150; // Default fallback rate
  }
}

// Calculate equivalent amount based on direction
async function calculateEquivalentAmount(amount, fromCurrency, toCurrency) {
  if (!amount || isNaN(parseFloat(amount))) {
    return '';
  }
  
  const rate = await fetchExchangeRate();
  const amountNum = parseFloat(amount);
  
  if (fromCurrency === 'XMR' && toCurrency === 'USDC') {
    // XMR to USDC: multiply by rate
    return (amountNum * rate).toFixed(2);
  } else if (fromCurrency === 'USDC' && toCurrency === 'XMR') {
    // USDC to XMR: divide by rate
    return (amountNum / rate).toFixed(6);
  }
  
  return amount; // Same currency or unsupported pair
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
    
    return prepareResult.swapId;
  } catch (error) {
    console.error('Error initiating XMR to USDC swap:', error);
    throw error;
  }
}

// Poll for swap status
async function pollSwapStatus(swapId) {
  try {
    const statusResponse = await fetch(`${SERVER_URL}/api/swaps/${swapId}/status`);
    const status = await statusResponse.json();
    console.log('Swap status:', status);
    return status;
  } catch (error) {
    console.error('Error polling swap status:', error);
    throw error;
  }
}

// Set up event listeners when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Connect wallet button
  const connectWalletBtn = document.getElementById('connectWalletBtn');
  if (connectWalletBtn) {
    connectWalletBtn.addEventListener('click', async function() {
      try {
        const { address } = await connectWallet();
        connectWalletBtn.textContent = address.substring(0, 6) + '...' + address.substring(address.length - 4);
        connectWalletBtn.classList.add('connected');
      } catch (error) {
        console.error('Failed to connect wallet:', error);
        alert('Failed to connect wallet. Please make sure MetaMask is installed and unlocked.');
      }
    });
  }

  // Initialize exchange rate display
  const exchangeRateDisplay = document.getElementById('exchangeRate');
  if (exchangeRateDisplay) {
    // Update exchange rate initially and every 60 seconds
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

  // Input amount handlers for dynamic conversion
  const sendAmount = document.getElementById('sendAmount');
  const receiveAmount = document.getElementById('receiveAmount');
  const sendCurrency = document.getElementById('sendCurrency');
  const receiveCurrency = document.getElementById('receiveCurrency');
  
  if (sendAmount && receiveAmount) {
    // When send amount changes, update receive amount
    sendAmount.addEventListener('input', async function() {
      try {
        const fromCurrency = sendCurrency.textContent.trim();
        const toCurrency = receiveCurrency.textContent.trim();
        const equivalentAmount = await calculateEquivalentAmount(
          sendAmount.value,
          fromCurrency,
          toCurrency
        );
        receiveAmount.value = equivalentAmount;
      } catch (error) {
        console.error('Error calculating equivalent amount:', error);
      }
    });
    
    // When receive amount changes, update send amount
    receiveAmount.addEventListener('input', async function() {
      try {
        const fromCurrency = receiveCurrency.textContent.trim();
        const toCurrency = sendCurrency.textContent.trim();
        const equivalentAmount = await calculateEquivalentAmount(
          receiveAmount.value,
          fromCurrency,
          toCurrency
        );
        sendAmount.value = equivalentAmount;
      } catch (error) {
        console.error('Error calculating equivalent amount:', error);
      }
    });
  }

  // Create swap button
  const createSwapBtn = document.getElementById('createSwapBtn');
  if (createSwapBtn) {
    createSwapBtn.addEventListener('click', async function() {
      try {
        const sendCurrency = document.getElementById('sendCurrency').textContent.trim();
        const receiveCurrency = document.getElementById('receiveCurrency').textContent.trim();
        const sendAmount = document.getElementById('sendAmount').value;
        const receiveAmount = document.getElementById('receiveAmount').value;
        const receiverAddress = document.getElementById('receiverAddress').value;
        
        if (!sendAmount || !receiveAmount || !receiverAddress) {
          alert('Please fill in all fields');
          return;
        }
        
        // Show loading state
        createSwapBtn.disabled = true;
        createSwapBtn.textContent = 'Creating swap...';
        
        if (sendCurrency === 'USDC' && receiveCurrency === 'XMR') {
          await initiateUsdcToXmrSwap(receiverAddress, sendAmount);
        } else if (sendCurrency === 'XMR' && receiveCurrency === 'USDC') {
          await initiateXmrToUsdcSwap(sendAmount, receiveAmount);
        }
        
        // Reset button state
        createSwapBtn.disabled = false;
        createSwapBtn.textContent = 'Create Swap';
      } catch (error) {
        console.error('Failed to create swap:', error);
        alert('Failed to create swap: ' + error.message);
        
        // Reset button state
        createSwapBtn.disabled = false;
        createSwapBtn.textContent = 'Create Swap';
      }
    });
  }

  // Swap direction button
  const swapDirectionBtn = document.getElementById('swapDirection');
  if (swapDirectionBtn) {
    swapDirectionBtn.addEventListener('click', async function() {
      const sendCurrency = document.getElementById('sendCurrency');
      const receiveCurrency = document.getElementById('receiveCurrency');
      const sendAmount = document.getElementById('sendAmount');
      const receiveAmount = document.getElementById('receiveAmount');
      
      // Swap currency display
      const tempCurrency = sendCurrency.innerHTML;
      sendCurrency.innerHTML = receiveCurrency.innerHTML;
      receiveCurrency.innerHTML = tempCurrency;
      
      // Recalculate based on the new send amount
      if (sendAmount.value) {
        const fromCurrency = sendCurrency.textContent.trim();
        const toCurrency = receiveCurrency.textContent.trim();
        const equivalentAmount = await calculateEquivalentAmount(
          sendAmount.value,
          fromCurrency,
          toCurrency
        );
        receiveAmount.value = equivalentAmount;
      }
    });
  }
});

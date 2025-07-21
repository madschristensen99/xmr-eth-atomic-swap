// Wrapper for ethers.min.js to make it work with non-module scripts
// This creates a global ethers object that can be used by other scripts
window.ethers = {
  providers: {
    Web3Provider: class Web3Provider {
      constructor(provider) {
        this.provider = provider;
        this.network = { chainId: provider.chainId };
      }
      
      getSigner() {
        return {
          getAddress: async () => {
            const accounts = await this.provider.request({ method: 'eth_requestAccounts' });
            return accounts[0];
          },
          signMessage: async (message) => {
            return await this.provider.request({
              method: 'personal_sign',
              params: [message, await this.getAddress()]
            });
          },
          sendTransaction: async (tx) => {
            return await this.provider.request({
              method: 'eth_sendTransaction',
              params: [tx]
            });
          }
        };
      }
    }
  },
  utils: {
    parseEther: (value) => {
      // Simple implementation for demo purposes
      const parsed = parseFloat(value);
      return BigInt(Math.floor(parsed * 1e18)).toString();
    },
    formatEther: (value) => {
      // Simple implementation for demo purposes
      const num = BigInt(value);
      return (Number(num) / 1e18).toString();
    }
  },
  Contract: class Contract {
    constructor(address, abi, signerOrProvider) {
      this.address = address;
      this.abi = abi;
      this.signer = signerOrProvider;
    }
    
    async newSwap(claimCommitment, refundCommitment, claimer, timeout1, timeout2, asset, value, nonce) {
      // Implementation would call the contract method
      console.log("Creating new swap with params:", {
        claimCommitment, refundCommitment, claimer, timeout1, timeout2, asset, value, nonce
      });
      
      return {
        hash: "0x" + Math.random().toString(16).substring(2, 10),
        wait: async () => ({ status: 1 })
      };
    }
    
    async setReady(swapObj) {
      console.log("Setting swap as ready:", swapObj);
      return {
        hash: "0x" + Math.random().toString(16).substring(2, 10),
        wait: async () => ({ status: 1 })
      };
    }
  }
};

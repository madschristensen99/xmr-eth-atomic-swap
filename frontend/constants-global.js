// Global constants for the atomic swap frontend
const SWAP_CREATOR_ADDRESS = "0xCa9209fAbc5B1fCF7935F99Ba588776222aB9c4c"; // Your contract address
const SWAP_CREATOR_ABI = [
	{
		"inputs": [
			{
				"components": [
					{
						"internalType": "address payable",
						"name": "owner",
						"type": "address"
					},
					{
						"internalType": "address payable",
						"name": "claimer",
						"type": "address"
					},
					{
						"internalType": "bytes32",
						"name": "claimCommitment",
						"type": "bytes32"
					},
					{
						"internalType": "bytes32",
						"name": "refundCommitment",
						"type": "bytes32"
					},
					{
						"internalType": "uint256",
						"name": "timeout1",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "timeout2",
						"type": "uint256"
					},
					{
						"internalType": "address",
						"name": "asset",
						"type": "address"
					},
					{
						"internalType": "uint256",
						"name": "value",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "nonce",
						"type": "uint256"
					}
				],
				"internalType": "struct SwapCreator.Swap",
				"name": "_swap",
				"type": "tuple"
			},
			{
				"internalType": "bytes32",
				"name": "_secret",
				"type": "bytes32"
			}
		],
		"name": "claim",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	}
]; // Shortened ABI for brevity
const CHAIN_ID = "0x14a34"; // Base Sepolia chain ID (e.g., "0x14a34" for 84532)
const RPC_URL = "https://sepolia.base.org"; // Base Sepolia RPC URL

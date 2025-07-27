// Package oneinch provides integration with 1inch Fusion escrow contracts for XMR-ETH atomic swaps.
package oneinch

import (
"context"
"crypto/ecdsa"
"errors"
"math/big"
"strings"

"github.com/ethereum/go-ethereum"
"github.com/ethereum/go-ethereum/accounts/abi"
"github.com/ethereum/go-ethereum/accounts/abi/bind"
"github.com/ethereum/go-ethereum/common"
"github.com/ethereum/go-ethereum/core/types"
"github.com/ethereum/go-ethereum/crypto"
"github.com/ethereum/go-ethereum/ethclient"

contracts "github.com/athanorlabs/atomic-swap/ethereum"
)

// Common errors
var (
ErrInvalidAddress     = errors.New("invalid address")
ErrTransactionFailed  = errors.New("transaction failed")
ErrContractNotFound   = errors.New("contract not found")
ErrInvalidSwapParams  = errors.New("invalid swap parameters")
ErrInsufficientFunds  = errors.New("insufficient funds")
ErrSwapAlreadyExists  = errors.New("swap already exists")
ErrSwapDoesNotExist   = errors.New("swap does not exist")
ErrInvalidSwapState   = errors.New("invalid swap state")
ErrInvalidSecret      = errors.New("invalid secret")
ErrTimeoutNotReached  = errors.New("timeout not reached")
ErrTimeoutExceeded    = errors.New("timeout exceeded")
)

// SwapParams contains the parameters for creating a new swap
type SwapParams struct {
Claimer          common.Address // Address that can claim the swap (taker)
ClaimCommitment  [32]byte       // Hash of the secret
RefundCommitment [32]byte       // Hash of the refund key
Timeout1         *big.Int       // First timeout (for claiming)
Timeout2         *big.Int       // Second timeout (for refunding)
Asset            common.Address // Token address (zero address for ETH)
Value            *big.Int       // Amount to swap
}

// XMREscrowClient provides methods to interact with the 1inch escrow contracts
type XMREscrowClient struct {
client         *ethclient.Client
factoryAddress common.Address
adapterAddress common.Address
swapCreator    *contracts.SwapCreator
privateKey     *ecdsa.PrivateKey

// Contract ABIs
escrowSrcABI     abi.ABI
escrowFactoryABI abi.ABI
swapAdapterABI   abi.ABI
}

// NewXMREscrowClient creates a new client for interacting with 1inch escrow contracts
func NewXMREscrowClient(
client *ethclient.Client,
swapCreator *contracts.SwapCreator,
factoryAddress common.Address,
adapterAddress common.Address,
privateKey *ecdsa.PrivateKey,
) (*XMREscrowClient, error) {
if client == nil {
return nil, errors.New("ethclient is required")
}

if swapCreator == nil {
return nil, errors.New("swap creator is required")
}

if privateKey == nil {
return nil, errors.New("private key is required")
}

if factoryAddress == (common.Address{}) {
return nil, errors.New("factory address is required")
}

if adapterAddress == (common.Address{}) {
return nil, errors.New("adapter address is required")
}

// Load contract ABIs
escrowSrcABI, err := loadEscrowSrcABI()
if err != nil {
return nil, err
}

escrowFactoryABI, err := loadEscrowFactoryABI()
if err != nil {
return nil, err
}

swapAdapterABI, err := loadSwapAdapterABI()
if err != nil {
return nil, err
}

return &XMREscrowClient{
client:          client,
swapCreator:     swapCreator,
factoryAddress:  factoryAddress,
adapterAddress:  adapterAddress,
privateKey:      privateKey,
escrowSrcABI:    escrowSrcABI,
escrowFactoryABI: escrowFactoryABI,
swapAdapterABI:  swapAdapterABI,
}, nil
}

// getAuth returns a transaction auth object for sending transactions
func (c *XMREscrowClient) getAuth(ctx context.Context) (*bind.TransactOpts, error) {
nonce, err := c.client.PendingNonceAt(ctx, crypto.PubkeyToAddress(c.privateKey.PublicKey))
if err != nil {
return nil, err
}

gasPrice, err := c.client.SuggestGasPrice(ctx)
if err != nil {
return nil, err
}

chainID, err := c.client.ChainID(ctx)
if err != nil {
return nil, err
}

auth, err := bind.NewKeyedTransactorWithChainID(c.privateKey, chainID)
if err != nil {
return nil, err
}

auth.Nonce = big.NewInt(int64(nonce))
auth.Value = big.NewInt(0)     // in wei
auth.GasLimit = uint64(300000) // in units
auth.GasPrice = gasPrice

return auth, nil
}

// calculateEscrowAddress calculates the address of the escrow contract for a given swap
func (c *XMREscrowClient) calculateEscrowAddress(ctx context.Context, params SwapParams) (common.Address, error) {
// Pack the function call
data, err := c.escrowFactoryABI.Pack("calculateEscrowAddress",
c.adapterAddress,
params.Claimer,
params.ClaimCommitment,
params.RefundCommitment,
params.Timeout1,
params.Timeout2,
params.Asset,
params.Value)
if err != nil {
return common.Address{}, err
}

// Call the contract
callMsg := ethereum.CallMsg{
To:   &c.factoryAddress,
Data: data,
}

result, err := c.client.CallContract(ctx, callMsg, nil)
if err != nil {
return common.Address{}, err
}

// Unpack the result
var escrowAddress common.Address
err = c.escrowFactoryABI.UnpackIntoInterface(&escrowAddress, "calculateEscrowAddress", result)
if err != nil {
return common.Address{}, err
}

return escrowAddress, nil
}

// CreateSwap creates a new swap using the 1inch escrow contracts
func (c *XMREscrowClient) CreateSwap(ctx context.Context, params SwapParams) (*types.Transaction, common.Address, error) {
// Get transaction auth
auth, err := c.getAuth(ctx)
if err != nil {
return nil, common.Address{}, err
}

// Set the value for ETH swaps
if params.Asset == (common.Address{}) {
auth.Value = params.Value
}

// Calculate the escrow address
escrowAddress, err := c.calculateEscrowAddress(ctx, params)
if err != nil {
return nil, common.Address{}, err
}

// Create and send the transaction using bound contract
contract := bind.NewBoundContract(c.factoryAddress, c.escrowFactoryABI, c.client, c.client, c.client)
tx, err := contract.Transact(auth, "deposit", 
c.adapterAddress,
params.Claimer,
params.ClaimCommitment,
params.RefundCommitment,
params.Timeout1,
params.Timeout2,
params.Asset,
params.Value)

if err != nil {
return nil, common.Address{}, err
}

return tx, escrowAddress, nil
}

// ClaimSwap claims a swap by providing the secret
func (c *XMREscrowClient) ClaimSwap(ctx context.Context, escrowAddress common.Address, secret [32]byte) (*types.Transaction, error) {
// Get transaction auth
auth, err := c.getAuth(ctx)
if err != nil {
return nil, err
}

// Create and send the transaction using bound contract
contract := bind.NewBoundContract(escrowAddress, c.escrowSrcABI, c.client, c.client, c.client)
tx, err := contract.Transact(auth, "withdraw", secret)

if err != nil {
return nil, err
}

return tx, nil
}

// RefundSwap refunds a swap after the timeout has passed
func (c *XMREscrowClient) RefundSwap(ctx context.Context, escrowAddress common.Address, refundKey [32]byte) (*types.Transaction, error) {
// Get transaction auth
auth, err := c.getAuth(ctx)
if err != nil {
return nil, err
}

// Create and send the transaction using bound contract
contract := bind.NewBoundContract(escrowAddress, c.escrowSrcABI, c.client, c.client, c.client)
tx, err := contract.Transact(auth, "refund", refundKey)

if err != nil {
return nil, err
}

return tx, nil
}

// GetSwapState gets the current state of a swap
func (c *XMREscrowClient) GetSwapState(ctx context.Context, escrowAddress common.Address) (uint8, error) {
// Pack the function call
data, err := c.escrowSrcABI.Pack("getState")
if err != nil {
return 0, err
}

// Call the contract
callMsg := ethereum.CallMsg{
To:   &escrowAddress,
Data: data,
}

result, err := c.client.CallContract(ctx, callMsg, nil)
if err != nil {
return 0, err
}

// Unpack the result
var state uint8
err = c.escrowSrcABI.UnpackIntoInterface(&state, "getState", result)
if err != nil {
return 0, err
}

return state, nil
}

// ConvertSwapCreatorSwapToParams converts a SwapCreator.Swap to SwapParams
func ConvertSwapCreatorSwapToParams(swap contracts.SwapCreatorSwap) SwapParams {
return SwapParams{
Claimer:          swap.Claimer,
ClaimCommitment:  swap.ClaimCommitment,
RefundCommitment: swap.RefundCommitment,
Timeout1:         swap.Timeout1,
Timeout2:         swap.Timeout2,
Asset:            swap.Asset,
Value:            swap.Value,
}
}

// loadEscrowSrcABI loads the ABI for the XMREscrowSrc contract
func loadEscrowSrcABI() (abi.ABI, error) {
const escrowSrcABIJSON = `[
{
"inputs": [
{"internalType": "bytes32", "name": "_secret", "type": "bytes32"}
],
"name": "withdraw",
"outputs": [],
"stateMutability": "nonpayable",
"type": "function"
},
{
"inputs": [
{"internalType": "bytes32", "name": "_refundKey", "type": "bytes32"}
],
"name": "refund",
"outputs": [],
"stateMutability": "nonpayable",
"type": "function"
},
{
"inputs": [],
"name": "getState",
"outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
"stateMutability": "view",
"type": "function"
}
]`
return abi.JSON(strings.NewReader(escrowSrcABIJSON))
}

// loadEscrowFactoryABI loads the ABI for the XMREscrowFactory contract
func loadEscrowFactoryABI() (abi.ABI, error) {
const escrowFactoryABIJSON = `[
{
"inputs": [
{"internalType": "address", "name": "_adapter", "type": "address"},
{"internalType": "address", "name": "_claimer", "type": "address"},
{"internalType": "bytes32", "name": "_claimCommitment", "type": "bytes32"},
{"internalType": "bytes32", "name": "_refundCommitment", "type": "bytes32"},
{"internalType": "uint256", "name": "_timeout1", "type": "uint256"},
{"internalType": "uint256", "name": "_timeout2", "type": "uint256"},
{"internalType": "address", "name": "_asset", "type": "address"},
{"internalType": "uint256", "name": "_value", "type": "uint256"}
],
"name": "calculateEscrowAddress",
"outputs": [{"internalType": "address", "name": "", "type": "address"}],
"stateMutability": "view",
"type": "function"
},
{
"inputs": [
{"internalType": "address", "name": "_adapter", "type": "address"},
{"internalType": "address", "name": "_claimer", "type": "address"},
{"internalType": "bytes32", "name": "_claimCommitment", "type": "bytes32"},
{"internalType": "bytes32", "name": "_refundCommitment", "type": "bytes32"},
{"internalType": "uint256", "name": "_timeout1", "type": "uint256"},
{"internalType": "uint256", "name": "_timeout2", "type": "uint256"},
{"internalType": "address", "name": "_asset", "type": "address"},
{"internalType": "uint256", "name": "_value", "type": "uint256"}
],
"name": "deposit",
"outputs": [{"internalType": "address", "name": "", "type": "address"}],
"stateMutability": "payable",
"type": "function"
}
]`
return abi.JSON(strings.NewReader(escrowFactoryABIJSON))
}

// loadSwapAdapterABI loads the ABI for the XMRSwapAdapter contract
func loadSwapAdapterABI() (abi.ABI, error) {
const swapAdapterABIJSON = `[
{
"inputs": [
{"internalType": "address", "name": "_claimer", "type": "address"},
{"internalType": "bytes32", "name": "_claimCommitment", "type": "bytes32"},
{"internalType": "bytes32", "name": "_refundCommitment", "type": "bytes32"},
{"internalType": "uint256", "name": "_timeout1", "type": "uint256"},
{"internalType": "uint256", "name": "_timeout2", "type": "uint256"},
{"internalType": "address", "name": "_asset", "type": "address"},
{"internalType": "uint256", "name": "_value", "type": "uint256"}
],
"name": "createSwap",
"outputs": [],
"stateMutability": "payable",
"type": "function"
},
{
"inputs": [
{"internalType": "bytes32", "name": "_secret", "type": "bytes32"}
],
"name": "claimSwap",
"outputs": [],
"stateMutability": "nonpayable",
"type": "function"
},
{
"inputs": [
{"internalType": "bytes32", "name": "_refundKey", "type": "bytes32"}
],
"name": "refundSwap",
"outputs": [],
"stateMutability": "nonpayable",
"type": "function"
}
]`
return abi.JSON(strings.NewReader(swapAdapterABIJSON))
}

// Package oneinch provides integration with 1inch Fusion escrow contracts for XMR-ETH atomic swaps.
package oneinch

import (
	"context"
	"fmt"

	ethcommon "github.com/ethereum/go-ethereum/common"

	contracts "github.com/athanorlabs/atomic-swap/ethereum"
	"github.com/athanorlabs/atomic-swap/ethereum/extethclient"
)

// InitializeEscrowClient creates a new XMREscrowClient with the given parameters
func InitializeEscrowClient(
	ctx context.Context,
	ethClient extethclient.EthClient,
	swapCreator *contracts.SwapCreator,
	factoryAddr, adapterAddr ethcommon.Address,
) (*XMREscrowClient, error) {
	if (factoryAddr == ethcommon.Address{}) {
		return nil, fmt.Errorf("escrow factory address is required")
	}

	if (adapterAddr == ethcommon.Address{}) {
		return nil, fmt.Errorf("escrow adapter address is required")
	}

	if swapCreator == nil {
		return nil, fmt.Errorf("swap creator is required")
	}

	// Get the raw ethclient.Client from the extethclient
	rawClient := ethClient.Raw()
	if rawClient == nil {
		return nil, fmt.Errorf("failed to get raw ethclient")
	}

	// Get the private key from the ethclient
	privateKey := ethClient.PrivateKey()
	if privateKey == nil {
		return nil, fmt.Errorf("failed to get private key from ethclient")
	}

	// Create the escrow client
	escrowClient, err := NewXMREscrowClient(
		rawClient,
		swapCreator,
		factoryAddr,
		adapterAddr,
		privateKey,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create escrow client: %w", err)
	}

	return escrowClient, nil
}

// CreateEscrowClientFromBackend creates a new XMREscrowClient from a backend interface
// that implements the necessary methods to get the required parameters
type EscrowBackend interface {
	ETHClient() extethclient.EthClient
	SwapCreator() *contracts.SwapCreator
	EscrowFactoryAddr() ethcommon.Address
	EscrowAdapterAddr() ethcommon.Address
	Ctx() context.Context
}

// CreateEscrowClientFromBackend creates a new XMREscrowClient from a backend interface
func CreateEscrowClientFromBackend(backend EscrowBackend) (*XMREscrowClient, error) {
	return InitializeEscrowClient(
		backend.Ctx(),
		backend.ETHClient(),
		backend.SwapCreator(),
		backend.EscrowFactoryAddr(),
		backend.EscrowAdapterAddr(),
	)
}

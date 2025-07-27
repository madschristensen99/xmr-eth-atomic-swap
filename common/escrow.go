// Copyright 2023 The AthanorLabs/atomic-swap Authors
// SPDX-License-Identifier: LGPL-3.0-only

package common

import (
	"fmt"
	"os"
	"strings"

	ethcommon "github.com/ethereum/go-ethereum/common"
)

const (
	// Environment variable names for escrow contract addresses
	escrowFactoryEnvVar  = "ESCROW_FACTORY_ADDRESS"
	escrowAdapterEnvVar  = "ESCROW_ADAPTER_ADDRESS"
)

// GetEscrowAddressesFromEnv loads the escrow contract addresses from environment variables
func GetEscrowAddressesFromEnv() (factoryAddr, adapterAddr ethcommon.Address, err error) {
	// Load factory address
	factoryAddrStr := os.Getenv(escrowFactoryEnvVar)
	if factoryAddrStr == "" {
		return ethcommon.Address{}, ethcommon.Address{}, fmt.Errorf("%s environment variable not set", escrowFactoryEnvVar)
	}
	
	// Ensure the address has the 0x prefix
	if !strings.HasPrefix(factoryAddrStr, "0x") {
		factoryAddrStr = "0x" + factoryAddrStr
	}
	
	// Validate factory address
	if !ethcommon.IsHexAddress(factoryAddrStr) {
		return ethcommon.Address{}, ethcommon.Address{}, fmt.Errorf("invalid ethereum address format for %s: %s", escrowFactoryEnvVar, factoryAddrStr)
	}
	factoryAddr = ethcommon.HexToAddress(factoryAddrStr)
	
	// Load adapter address
	adapterAddrStr := os.Getenv(escrowAdapterEnvVar)
	if adapterAddrStr == "" {
		return ethcommon.Address{}, ethcommon.Address{}, fmt.Errorf("%s environment variable not set", escrowAdapterEnvVar)
	}
	
	// Ensure the address has the 0x prefix
	if !strings.HasPrefix(adapterAddrStr, "0x") {
		adapterAddrStr = "0x" + adapterAddrStr
	}
	
	// Validate adapter address
	if !ethcommon.IsHexAddress(adapterAddrStr) {
		return ethcommon.Address{}, ethcommon.Address{}, fmt.Errorf("invalid ethereum address format for %s: %s", escrowAdapterEnvVar, adapterAddrStr)
	}
	adapterAddr = ethcommon.HexToAddress(adapterAddrStr)
	
	return factoryAddr, adapterAddr, nil
}

// GetEscrowAddressesWithFallback loads the escrow contract addresses from environment variables
// with fallback to zero addresses if not set
func GetEscrowAddressesWithFallback() (factoryAddr, adapterAddr ethcommon.Address) {
	factoryAddr, adapterAddr, err := GetEscrowAddressesFromEnv()
	if err != nil {
		// If there's an error, just return zero addresses
		return ethcommon.Address{}, ethcommon.Address{}
	}
	return factoryAddr, adapterAddr
}

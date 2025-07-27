// Copyright 2023 The AthanorLabs/atomic-swap Authors
// SPDX-License-Identifier: LGPL-3.0-only

package backend

import (
	"fmt"

	"github.com/athanorlabs/atomic-swap/ethereum/oneinch"
)

// EscrowClient returns the initialized 1inch escrow client
func (b *backend) EscrowClient() (*oneinch.XMREscrowClient, error) {
	if b.escrowClient == nil {
		return nil, fmt.Errorf("escrow client not initialized, escrow addresses may not be configured")
	}
	return b.escrowClient, nil
}

// HasEscrowClient returns true if the escrow client is initialized
func (b *backend) HasEscrowClient() bool {
	return b.escrowClient != nil
}

// Note: SwapCreator method is already defined in backend.go

#!/usr/bin/env bash

set -e

# Use the project root (one directory above this script) as the current working directory:
PROJECT_ROOT="$(dirname "$(dirname "$(realpath "$0")")")"
cd "${PROJECT_ROOT}"

ABIGEN="$(go env GOPATH)/bin/abigen"

if [[ -z "${SOLC_BIN}" ]]; then
	SOLC_BIN=solc
fi

compile-contract() {
	local solidity_file_name="${1:?}"
	local go_type_name="${2:?}"
	local go_file_name="${3:?}"
	local contract_path="${4:-ethereum/contracts}"

	# strip leading path and extension from to get the solidity type name
	local solidity_type_name
	solidity_type_name="$(basename "${solidity_file_name%.sol}")"

	echo "Generating go bindings for ${solidity_type_name}"

	"${SOLC_BIN}" --optimize --optimize-runs=200 \
		--metadata --metadata-literal \
		--base-path "${contract_path}" \
		--include-path "/home/remsee/hashield/evm/node_modules" \
		--abi "${contract_path}/${solidity_file_name}" \
		-o ethereum/abi/ --overwrite
	"${SOLC_BIN}" --optimize --optimize-runs=200 \
		--base-path "${contract_path}" \
		--include-path "/home/remsee/hashield/evm/node_modules" \
		--bin "${contract_path}/${solidity_file_name}" \
		-o ethereum/bin/ --overwrite

	"${ABIGEN}" \
		--abi "ethereum/abi/${solidity_type_name}.abi" \
		--bin "ethereum/bin/${solidity_type_name}.bin" \
		--pkg contracts \
		--type "${go_type_name}" \
		--out "ethereum/${go_file_name}.go"
}

# Generate bindings for the 1inch escrow contracts
compile-contract XMREscrowSrc.sol XMREscrowSrc xmr_escrow_src "../evm/contracts"
compile-contract XMREscrowFactory.sol XMREscrowFactory xmr_escrow_factory "../evm/contracts"
compile-contract XMRSwapIntegration.sol XMRSwapAdapter xmr_swap_adapter "../evm/contracts"

echo "Escrow contract bindings generated successfully"

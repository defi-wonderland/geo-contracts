// Copyright 2021-2022, Offchain Labs, Inc.
// For license information, see https://github.com/OffchainLabs/nitro-contracts/blob/main/LICENSE
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.8;

// ArbSys does not work on Arbitrum Fork (https://github.com/NomicFoundation/hardhat/issues/4469)
contract TestArbSys {
    function sendTxToL1(
        address destination,
        bytes calldata data
    ) external payable returns (uint256) {}
}

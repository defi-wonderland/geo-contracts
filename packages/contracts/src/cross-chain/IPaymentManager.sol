// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

/**
 * @title IPaymentManager
 * @notice Interface for managing GEO token payments to Spaces with a thawing period and Council oversight.
 */
interface IPaymentManager {
    // -------- FUNCTIONS --------

    /**
     * @notice Sets the payer for a space via cross-chain message
     * @dev Can only be called by the Bridge contract after verification by the Outbox
     * @param _payer Address of the payer
     */
    function setPayer(address _payer) external;
}

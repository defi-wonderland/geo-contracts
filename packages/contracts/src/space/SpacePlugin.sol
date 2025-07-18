// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.8;

import {IDAO, PluginUUPSUpgradeable} from "@aragon/osx/core/plugin/PluginUUPSUpgradeable.sol";
import {CONTENT_PERMISSION_ID, SUBSPACE_PERMISSION_ID, PAYER_PERMISSION_ID} from "../constants.sol";

bytes4 constant SPACE_INTERFACE_ID = SpacePlugin.initialize.selector ^
    SpacePlugin.publishEdits.selector ^
    SpacePlugin.flagContent.selector ^
    SpacePlugin.acceptSubspace.selector ^
    SpacePlugin.removeSubspace.selector ^
    SpacePlugin.setPayer.selector;

/// @title SpacePlugin
/// @dev Release 1, Build 1
contract SpacePlugin is PluginUUPSUpgradeable {
    /// @notice The address authorized to create payments on behalf of the current Space DAO.
    /// @dev This address must be set via a governance proposal executed by the DAO.
    address public payer;

    /// @notice Emitted when the contents of a space change.
    /// @param dao The address of the DAO where this proposal was executed.
    /// @param editsContentUri An IPFS URI pointing to the new contents behind the block's item.
    /// @param editsMetadata The metadata associated with the new contents behind the block's item.
    event EditsPublished(address dao, string editsContentUri, bytes editsMetadata);

    /// @notice Emitted when a content is flagged.
    /// @param dao The address of the DAO where this proposal was executed.
    /// @param flagContentUri An IPFS URI pointing to the content being flagged.
    event ContentFlagged(address dao, string flagContentUri);

    /// @notice Announces that the current space plugin is the successor of an already existing Space
    /// @param dao The address of the DAO where this proposal was executed.
    /// @param predecessorSpace The address of the space contract that the plugin will replace
    event SuccessorSpaceCreated(address dao, address predecessorSpace);

    /// @notice Emitted when the DAO accepts another DAO as a subspace.
    /// @param dao The address of the DAO where this proposal was executed.
    /// @param subspaceDao The address of the DAO to be accepted as a subspace.
    event SubspaceAccepted(address dao, address subspaceDao);

    /// @notice Emitted when the DAO stops recognizing another DAO as a subspace.
    /// @param dao The address of the DAO where this proposal was executed.
    /// @param subspaceDao The address of the DAO to be removed as a subspace.
    event SubspaceRemoved(address dao, address subspaceDao);

    /// @notice Emitted when a payer is set for a Space DAO.
    /// @param dao The address of the DAO where this proposal was executed.
    /// @param payer The address authorized to create payments for that DAO.
    event PayerSet(address dao, address payer);

    /// @notice Initializes the plugin when build 1 is installed.
    /// @param _dao The address of the DAO to read the permissions from.
    /// @param _firstEditsContentUri An IPFS URI pointing to the contents of the first block's item (title).
    /// @param _firstEditsMetadata The metadata associated with the contents of the first block's item (title).
    /// @param _predecessorSpace Optionally, the address of the space contract preceding this one.
    function initialize(
        IDAO _dao,
        string memory _firstEditsContentUri,
        bytes memory _firstEditsMetadata,
        address _predecessorSpace
    ) external initializer {
        __PluginUUPSUpgradeable_init(_dao);

        if (_predecessorSpace != address(0)) {
            emit SuccessorSpaceCreated(address(dao()), _predecessorSpace);
        }
        emit EditsPublished({
            dao: address(dao()),
            editsContentUri: _firstEditsContentUri,
            editsMetadata: _firstEditsMetadata
        });
    }

    /// @notice Checks if this or the parent contract supports an interface by its ID.
    /// @param _interfaceId The ID of the interface.
    /// @return Returns `true` if the interface is supported.
    function supportsInterface(
        bytes4 _interfaceId
    ) public view override(PluginUUPSUpgradeable) returns (bool) {
        return _interfaceId == SPACE_INTERFACE_ID || super.supportsInterface(_interfaceId);
    }

    /// @notice Emits an event with new contents for the given block index. Caller needs CONTENT_PERMISSION.
    /// @param _editsContentUri An IPFS URI pointing to the new contents behind the block's item.
    /// @param _editsMetadata The metadata associated with the new contents behind the block's item.
    function publishEdits(
        string memory _editsContentUri,
        bytes memory _editsMetadata
    ) external auth(CONTENT_PERMISSION_ID) {
        emit EditsPublished({
            dao: address(dao()),
            editsContentUri: _editsContentUri,
            editsMetadata: _editsMetadata
        });
    }

    /// @notice Emits an event when the content is flagged. Caller needs CONTENT_PERMISSION.
    /// @param _flagContentUri An IPFS URI pointing to the content being flagged.
    function flagContent(string memory _flagContentUri) external auth(CONTENT_PERMISSION_ID) {
        emit ContentFlagged({dao: address(dao()), flagContentUri: _flagContentUri});
    }

    /// @notice Emits an event accepting another DAO as a subspace. Caller needs CONTENT_PERMISSION.
    /// @param _subspaceDao The address of the DAO to accept as a subspace.
    function acceptSubspace(address _subspaceDao) external auth(SUBSPACE_PERMISSION_ID) {
        emit SubspaceAccepted(address(dao()), _subspaceDao);
    }

    /// @notice Emits an event removing another DAO as a subspace. Caller needs CONTENT_PERMISSION.
    /// @param _subspaceDao The address of the DAO to remove as a subspace.
    function removeSubspace(address _subspaceDao) external auth(SUBSPACE_PERMISSION_ID) {
        emit SubspaceRemoved(address(dao()), _subspaceDao);
    }

    /// @notice Sets the payer address for the Space DAO.
    /// @param _payer The address authorized to create payments on behalf of the DAO.
    function setPayer(address _payer) external auth(PAYER_PERMISSION_ID) {
        if (_payer == payer) return;

        payer = _payer;
        emit PayerSet(address(dao()), _payer);
    }

    /// @notice This empty reserved space is put in place to allow future versions to add new variables without shifting down storage in the inheritance chain (see [OpenZeppelin's guide about storage gaps](https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps)).
    uint256[50] private __gap;
}

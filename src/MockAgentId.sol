// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =====================================================================
// TEST ONLY — NEVER DEPLOY THIS MOCK ON MAINNET.
//
// This is a dependency-free stand-in for the real Agent ID contract,
// used only in local tests and testnet demos. The real Agent ID
// contract on BSC mainnet is:
//
//     0x60b9262456de011f7d15a54cdd8c48baaa8b022f
//
// (SPACE ID, ERC-721, non-transferable.) AgentProof only calls
// balanceOf(address), which this mock implements with the same
// signature, so the registry code is identical against either one.
// =====================================================================

/// @title MockAgentId
/// @notice Minimal ERC-721-like mock: mint(to) grants exactly one token.
contract MockAgentId {
    /// @dev owner => token balance. The public getter matches
    ///      IAgentId.balanceOf(address) exactly.
    mapping(address => uint256) public balanceOf;

    /// @dev tokenId => owner.
    mapping(uint256 => address) public ownerOf;

    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /// @notice Grant one fresh token to `to`.
    function mint(address to) external {
        uint256 tokenId = totalSupply + 1;
        totalSupply = tokenId;
        ownerOf[tokenId] = to;
        unchecked {
            balanceOf[to] += 1;
        }
        emit Transfer(address(0), to, tokenId);
    }
}

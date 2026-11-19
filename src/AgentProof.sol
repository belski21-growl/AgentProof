// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal inline interface for the Agent ID token (ERC-721 style).
///         Only balanceOf is needed: holding >= 1 Agent ID grants attest rights.
interface IAgentId {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentProof
/// @notice On-chain registry where Agent ID holders attest free-mint NFT
///         contracts they have security-verified. Target chain: BSC.
///
///         Design goals: minimal, gas-cheap, and fully permissionless.
///         There is NO owner, admin, pause, upgrade or rescue function.
///         Nobody can censor, pause, alter or delete an attestation once
///         written; only the attesting agent can update their own entry.
///         The only gate is holding an Agent ID (balanceOf > 0).
contract AgentProof {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @notice 0 = safe to mint, 1 = hold / needs more checks,
    ///         2 = block / template or scam.
    enum Verdict {
        SAFE,
        HOLD,
        BLOCK
    }

    /// @dev verdict (1 byte) + exists (1 byte) + timestamp (8 bytes) pack
    ///      into one storage slot; evidenceHash occupies a second slot.
    struct Attestation {
        uint8 verdict;
        bool exists;
        uint64 timestamp;
        bytes32 evidenceHash;
    }

    // ------------------------------------------------------------------
    // Errors (custom errors only, no revert strings)
    // ------------------------------------------------------------------

    error NotAgentIdHolder();
    error ZeroAddress();
    error InvalidVerdict();
    error IndexOutOfBounds();

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event Attested(
        address indexed agent,
        address indexed nftContract,
        uint8 verdict,
        bytes32 evidenceHash,
        uint64 timestamp
    );

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    /// @notice The Agent ID token contract used for the holder gate.
    address public immutable agentIdContract;

    /// @dev nftContract => agent => attestation.
    mapping(address => mapping(address => Attestation)) internal _attestations;

    /// @dev nftContract => number of distinct agents that attested it.
    mapping(address => uint256) internal _attestationCount;

    /// @dev Global list of attested contracts, in first-attest order.
    address[] internal _attestedContracts;
    mapping(address => bool) internal _attestedContractSeen;

    /// @dev Per-agent list of contracts they attested, in first-attest order.
    mapping(address => address[]) internal _agentContracts;
    /// @dev agent => nftContract => index + 1 in _agentContracts[agent]
    ///      (0 means "not present"); used for dedupe.
    mapping(address => mapping(address => uint256)) internal _agentContractIndex;

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    constructor(address _agentIdContract) {
        if (_agentIdContract == address(0)) revert ZeroAddress();
        agentIdContract = _agentIdContract;
    }

    // ------------------------------------------------------------------
    // Write
    // ------------------------------------------------------------------

    /// @notice Attest a verdict for an NFT contract. Requires holding at
    ///         least one Agent ID. Re-attesting updates the caller's own
    ///         entry (verdict, evidenceHash, timestamp); counts and list
    ///         positions never change on update.
    /// @param nftContract The free-mint NFT contract being attested.
    /// @param verdict 0 = SAFE, 1 = HOLD, 2 = BLOCK.
    /// @param evidenceHash Hash of the off-chain verification evidence
    ///        (e.g. keccak256 of a report pinned to IPFS/Arweave).
    function attest(address nftContract, uint8 verdict, bytes32 evidenceHash) external {
        // Strict equality with 0 is the intended gate: attest rights require
        // a nonzero Agent ID balance, exactly as specified.
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (IAgentId(agentIdContract).balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (nftContract == address(0)) revert ZeroAddress();
        if (verdict > uint8(Verdict.BLOCK)) revert InvalidVerdict();

        Attestation storage a = _attestations[nftContract][msg.sender];
        // Casting to uint64 is safe: block.timestamp in seconds fits uint64
        // until ~year 584 billion; the struct packs it to save a storage slot.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 ts = uint64(block.timestamp);

        // Per-agent dedupe via the index mapping (0 = never attested).
        if (_agentContractIndex[msg.sender][nftContract] == 0) {
            a.exists = true;
            unchecked {
                // Distinct-agent count per contract; overflow is impossible
                // in practice (bounded by the number of Agent ID holders).
                _attestationCount[nftContract] += 1;
            }
            // Global dedupe: push each contract only on its first attest.
            if (!_attestedContractSeen[nftContract]) {
                _attestedContractSeen[nftContract] = true;
                _attestedContracts.push(nftContract);
            }
            address[] storage list = _agentContracts[msg.sender];
            list.push(nftContract);
            _agentContractIndex[msg.sender][nftContract] = list.length; // index + 1
        }

        a.verdict = verdict;
        a.timestamp = ts;
        a.evidenceHash = evidenceHash;

        emit Attested(msg.sender, nftContract, verdict, evidenceHash, ts);
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /// @notice Full attestation of `agent` for `nftContract`.
    function getAttestation(address nftContract, address agent)
        external
        view
        returns (uint8 verdict, bytes32 evidenceHash, uint64 timestamp, bool exists)
    {
        Attestation storage a = _attestations[nftContract][agent];
        return (a.verdict, a.evidenceHash, a.timestamp, a.exists);
    }

    /// @notice Number of distinct agents that attested `nftContract`.
    function attestationCount(address nftContract) external view returns (uint256) {
        return _attestationCount[nftContract];
    }

    /// @notice Whether `agent` has attested `nftContract`.
    function hasAttested(address nftContract, address agent) external view returns (bool) {
        return _attestations[nftContract][agent].exists;
    }

    /// @notice Length of the global first-attest-order contract list.
    function attestedContractsCount() external view returns (uint256) {
        return _attestedContracts.length;
    }

    /// @notice Global list accessor, in first-attest order.
    function attestedContractAt(uint256 index) external view returns (address) {
        if (index >= _attestedContracts.length) revert IndexOutOfBounds();
        return _attestedContracts[index];
    }

    /// @notice All contracts `agent` has attested, in first-attest order.
    function contractsAttestedBy(address agent) external view returns (address[] memory) {
        return _agentContracts[agent];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentProof} from "../src/AgentProof.sol";
import {MockAgentId} from "../src/MockAgentId.sol";

contract AgentProofTest is Test {
    AgentProof internal proof;
    MockAgentId internal agentId;

    address internal alice = makeAddr("alice"); // holder
    address internal bob = makeAddr("bob"); // holder
    address internal carol = makeAddr("carol"); // non-holder

    address internal nftA = makeAddr("nftA");
    address internal nftB = makeAddr("nftB");
    address internal nftC = makeAddr("nftC");

    bytes32 internal constant HASH1 = keccak256("evidence-report-v1");
    bytes32 internal constant HASH2 = keccak256("evidence-report-v2");

    function setUp() public {
        agentId = new MockAgentId();
        proof = new AgentProof(address(agentId));
        agentId.mint(alice);
        agentId.mint(bob);
        vm.warp(1_700_000_000);
    }

    // ------------------------------------------------------------------
    // 1. Non-holder cannot attest
    // ------------------------------------------------------------------

    function test_RevertWhen_NotAgentIdHolder() public {
        assertEq(agentId.balanceOf(carol), 0);
        vm.prank(carol);
        vm.expectRevert(AgentProof.NotAgentIdHolder.selector);
        proof.attest(nftA, 0, HASH1);
    }

    // ------------------------------------------------------------------
    // 2. Holder attests; exact values stored; count == 1
    // ------------------------------------------------------------------

    function test_HolderAttest_StoresExactValues() public {
        vm.expectEmit(true, true, false, true, address(proof));
        emit AgentProof.Attested(alice, nftA, 0, HASH1, uint64(block.timestamp));

        vm.prank(alice);
        proof.attest(nftA, 0, HASH1);

        (uint8 verdict, bytes32 evidenceHash, uint64 timestamp, bool exists) =
            proof.getAttestation(nftA, alice);
        assertEq(verdict, 0);
        assertEq(evidenceHash, HASH1);
        assertEq(timestamp, uint64(1_700_000_000));
        assertTrue(exists);
        assertEq(proof.attestationCount(nftA), 1);
        assertTrue(proof.hasAttested(nftA, alice));
        assertFalse(proof.hasAttested(nftA, bob));
    }

    // ------------------------------------------------------------------
    // 3. Same agent updates; count stays 1; values updated
    // ------------------------------------------------------------------

    function test_UpdateAttestation_CountUnchanged() public {
        vm.startPrank(alice);
        proof.attest(nftA, 0, HASH1);

        vm.warp(block.timestamp + 3600);
        proof.attest(nftA, 2, HASH2);
        vm.stopPrank();

        (uint8 verdict, bytes32 evidenceHash, uint64 timestamp, bool exists) =
            proof.getAttestation(nftA, alice);
        assertEq(verdict, 2);
        assertEq(evidenceHash, HASH2);
        assertEq(timestamp, uint64(1_700_000_000 + 3600));
        assertTrue(exists);

        assertEq(proof.attestationCount(nftA), 1);
        assertEq(proof.attestedContractsCount(), 1);
        assertEq(proof.contractsAttestedBy(alice).length, 1);
    }

    // ------------------------------------------------------------------
    // 4. Second holder attests same contract; count == 2
    // ------------------------------------------------------------------

    function test_SecondHolderSameContract_CountTwo() public {
        vm.prank(alice);
        proof.attest(nftA, 0, HASH1);
        vm.prank(bob);
        proof.attest(nftA, 1, HASH2);

        assertEq(proof.attestationCount(nftA), 2);
        assertTrue(proof.hasAttested(nftA, alice));
        assertTrue(proof.hasAttested(nftA, bob));

        (uint8 vA,,,) = proof.getAttestation(nftA, alice);
        (uint8 vB,,,) = proof.getAttestation(nftA, bob);
        assertEq(vA, 0);
        assertEq(vB, 1);

        // Global list still contains the contract exactly once.
        assertEq(proof.attestedContractsCount(), 1);
        assertEq(proof.attestedContractAt(0), nftA);
    }

    // ------------------------------------------------------------------
    // 5. Invalid verdict / zero address revert
    // ------------------------------------------------------------------

    function test_RevertWhen_InvalidVerdict() public {
        vm.prank(alice);
        vm.expectRevert(AgentProof.InvalidVerdict.selector);
        proof.attest(nftA, 3, HASH1);
    }

    function test_RevertWhen_ZeroAddressContract() public {
        vm.prank(alice);
        vm.expectRevert(AgentProof.ZeroAddress.selector);
        proof.attest(address(0), 0, HASH1);
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(AgentProof.ZeroAddress.selector);
        new AgentProof(address(0));
    }

    // ------------------------------------------------------------------
    // 6. Enumeration: global order + per-agent lists
    // ------------------------------------------------------------------

    function test_Enumeration_GlobalAndPerAgentOrder() public {
        vm.startPrank(alice);
        proof.attest(nftA, 0, HASH1); // global[0], alice[0]
        proof.attest(nftB, 1, HASH1); // global[1], alice[1]
        vm.stopPrank();

        vm.startPrank(bob);
        proof.attest(nftB, 2, HASH2); // already global; bob[0]
        proof.attest(nftC, 0, HASH2); // global[2], bob[1]
        proof.attest(nftA, 2, HASH2); // already global; bob[2]
        vm.stopPrank();

        // Global first-attest order: A, B, C (no duplicates).
        assertEq(proof.attestedContractsCount(), 3);
        assertEq(proof.attestedContractAt(0), nftA);
        assertEq(proof.attestedContractAt(1), nftB);
        assertEq(proof.attestedContractAt(2), nftC);

        // Per-agent first-attest order.
        address[] memory aliceList = proof.contractsAttestedBy(alice);
        assertEq(aliceList.length, 2);
        assertEq(aliceList[0], nftA);
        assertEq(aliceList[1], nftB);

        address[] memory bobList = proof.contractsAttestedBy(bob);
        assertEq(bobList.length, 3);
        assertEq(bobList[0], nftB);
        assertEq(bobList[1], nftC);
        assertEq(bobList[2], nftA);

        // Non-attesting holder has an empty list.
        assertEq(proof.contractsAttestedBy(carol).length, 0);

        // Counts per contract.
        assertEq(proof.attestationCount(nftA), 2);
        assertEq(proof.attestationCount(nftB), 2);
        assertEq(proof.attestationCount(nftC), 1);

        // Out-of-bounds accessor reverts with a custom error.
        vm.expectRevert(AgentProof.IndexOutOfBounds.selector);
        proof.attestedContractAt(3);
    }

    function test_UpdateDoesNotDuplicateLists() public {
        vm.startPrank(alice);
        proof.attest(nftA, 0, HASH1);
        proof.attest(nftA, 1, HASH2);
        proof.attest(nftA, 2, HASH1);
        vm.stopPrank();

        assertEq(proof.attestedContractsCount(), 1);
        assertEq(proof.contractsAttestedBy(alice).length, 1);
        assertEq(proof.attestationCount(nftA), 1);
    }

    // ------------------------------------------------------------------
    // 7. Mock mint gives balanceOf 1; attest works after mint
    // ------------------------------------------------------------------

    function test_MockMint_BalanceOneThenAttest() public {
        address dave = makeAddr("dave");
        assertEq(agentId.balanceOf(dave), 0);

        agentId.mint(dave);
        assertEq(agentId.balanceOf(dave), 1);
        // setUp already minted tokens 1 (alice) and 2 (bob); dave gets 3.
        assertEq(agentId.totalSupply(), 3);
        assertEq(agentId.ownerOf(3), dave);

        vm.prank(dave);
        proof.attest(nftC, 1, HASH2);
        assertTrue(proof.hasAttested(nftC, dave));
        assertEq(proof.attestationCount(nftC), 1);
    }

    // ------------------------------------------------------------------
    // Gas measurements (used for GAS-REPORT.md; gasleft deltas include
    // the 21k intrinsic + calldata cost of the external call)
    // ------------------------------------------------------------------

    function test_Gas_AttestFirstCall() public {
        vm.prank(alice);
        uint256 before = gasleft();
        proof.attest(nftA, 0, HASH1);
        uint256 used = before - gasleft();
        emit log_named_uint("attest first-call gas", used);
    }

    function test_Gas_AttestUpdateCall() public {
        vm.prank(alice);
        proof.attest(nftA, 0, HASH1);
        vm.prank(alice);
        uint256 before = gasleft();
        proof.attest(nftA, 2, HASH2);
        uint256 used = before - gasleft();
        emit log_named_uint("attest update-call gas", used);
    }
}

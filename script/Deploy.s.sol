// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {AgentProof} from "../src/AgentProof.sol";
import {MockAgentId} from "../src/MockAgentId.sol";

/// @notice Deploys AgentProof, plus MockAgentId ONLY when no real Agent ID
///         address is provided (local anvil / testnet demo mode).
///
///         The Agent ID contract address used by AgentProof comes from the
///         AGENT_ID_CONTRACT environment variable — it is never hardcoded.
///         If AGENT_ID_CONTRACT is unset or zero, the freshly deployed mock
///         is used instead. If it IS set, the mock is NOT deployed at all:
///         on mainnet this saves 167,505 gas (~0.000168 BNB @ 1 gwei).
///
///         NO private key is read from any file by this script. The deployer
///         signer is supplied at runtime by the coordinator via forge flags,
///         e.g. (testnet only, run by the coordinator):
///
///           AGENT_ID_CONTRACT=0x... forge script script/Deploy.s.sol \
///             --rpc-url <testnet-rpc> --broadcast --private-key <runtime-key>
///
///         This script is never broadcast from the build environment.
contract Deploy is Script {
    function run() external {
        address agentIdFromEnv = vm.envOr("AGENT_ID_CONTRACT", address(0));

        vm.startBroadcast();

        address agentIdContract;
        if (agentIdFromEnv == address(0)) {
            MockAgentId mock = new MockAgentId();
            agentIdContract = address(mock);
            console2.log("MockAgentId deployed at:", address(mock));
            console2.log("Mode: AGENT_ID_CONTRACT unset -> using the deployed mock (TEST ONLY).");
        } else {
            agentIdContract = agentIdFromEnv;
            console2.log("Mode: AGENT_ID_CONTRACT from environment - mock NOT deployed.");
        }
        AgentProof proof = new AgentProof(agentIdContract);

        vm.stopBroadcast();

        console2.log("AgentProof  deployed at:", address(proof));
        console2.log("Agent ID contract used :", agentIdContract);
    }
}

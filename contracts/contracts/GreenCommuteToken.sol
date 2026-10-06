// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract GreenCommuteToken is ERC20, Ownable, EIP712 {
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address user,uint256 amount,uint256 nonce,uint256 expiry)");

    string public constant SIGNING_DOMAIN = "GreenCommuteToken";
    string public constant SIGNATURE_VERSION = "1";

    address public oracle;

    mapping(address => mapping(uint256 => bool)) public usedNonces;

    event OracleUpdated(address indexed previousOracle, address indexed newOracle);
    event RewardClaimed(address indexed user, uint256 amount, uint256 nonce);

    error InvalidOracle();
    error InvalidCaller();
    error InvalidSignature();
    error SignatureExpired();
    error NonceAlreadyUsed();

    constructor(address initialOracle)
        ERC20("Green Commute Token", "GCT")
        Ownable(msg.sender)
        EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION)
    {
        if (initialOracle == address(0)) revert InvalidOracle();
        oracle = initialOracle;
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidOracle();

        address previousOracle = oracle;
        oracle = newOracle;

        emit OracleUpdated(previousOracle, newOracle);
    }

    function claimReward(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external returns (bool) {
        if (msg.sender != user) revert InvalidCaller();
        if (block.timestamp > expiry) revert SignatureExpired();
        if (usedNonces[user][nonce]) revert NonceAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                user,
                amount,
                nonce,
                expiry
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);

        if (recoveredSigner != oracle) revert InvalidSignature();

        usedNonces[user][nonce] = true;
        _mint(user, amount);

        emit RewardClaimed(user, amount, nonce);
        return true;
    }

    function verifyClaimSignature(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external view returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                user,
                amount,
                nonce,
                expiry
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);

        return recoveredSigner == oracle;
    }
}
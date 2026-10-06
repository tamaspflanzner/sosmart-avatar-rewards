// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";

contract GreenCommuteCosmetics is
    ERC1155,
    ERC1155Burnable,
    ERC1155Supply,
    ERC1155URIStorage,
    Ownable
{
    mapping(address => bool) public minters;

    event MinterUpdated(address indexed account, bool allowed);
    event CosmeticMinted(address indexed to, uint256 indexed tokenId, uint256 amount);
    event CosmeticBatchMinted(address indexed to, uint256[] tokenIds, uint256[] amounts);

    error UnauthorizedMinter();
    error InvalidArrayLength();
    error ZeroAddress();

    constructor(string memory defaultUri, address initialOwner)
        ERC1155(defaultUri)
        Ownable(initialOwner)
    {}

    modifier onlyMinter() {
        if (msg.sender != owner() && !minters[msg.sender]) revert UnauthorizedMinter();
        _;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        minters[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    function setTokenUri(uint256 tokenId, string calldata tokenUri) external onlyOwner {
        _setURI(tokenId, tokenUri);
    }

    function setTokenUris(
        uint256[] calldata tokenIds,
        string[] calldata tokenUris
    ) external onlyOwner {
        uint256 length = tokenIds.length;
        if (length != tokenUris.length) revert InvalidArrayLength();

        for (uint256 i = 0; i < length; i++) {
            _setURI(tokenIds[i], tokenUris[i]);
        }
    }

    function mintTo(
        address to,
        uint256 tokenId,
        uint256 amount,
        bytes calldata data
    ) external onlyMinter {
        _mint(to, tokenId, amount, data);
        emit CosmeticMinted(to, tokenId, amount);
    }

    function mintBatchTo(
        address to,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts,
        bytes calldata data
    ) external onlyMinter {
        if (tokenIds.length != amounts.length) revert InvalidArrayLength();
        _mintBatch(to, tokenIds, amounts, data);
        emit CosmeticBatchMinted(to, tokenIds, amounts);
    }

    function uri(uint256 tokenId)
        public
        view
        override(ERC1155, ERC1155URIStorage)
        returns (string memory)
    {
        return super.uri(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}

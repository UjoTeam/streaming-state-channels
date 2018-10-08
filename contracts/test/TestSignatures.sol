pragma solidity 0.4.24;

import "../lib/Signatures.sol";


contract TestSignatures {
  using Signatures for bytes;

  function verify(bytes toApply, bytes32 txHash, address[] signers) public view returns (bool) {
    return toApply.verifySignatures(txHash, signers);
  }

  function recover(bytes toApply, bytes32 txHash, uint256 pos) public view returns (address) {
    return toApply.recoverKey(txHash, pos);
  }

}
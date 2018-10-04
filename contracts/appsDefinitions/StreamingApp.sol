pragma solidity 0.4.24;
pragma experimental "ABIEncoderV2";

import "../lib/Transfer.sol";


contract StreamingApp {
  struct AppState {
    address artist;
    address user;
    uint256 streamingPrice;
    uint256 artistBalance;
    uint256 userBalance;
  }

  event Stream(string _cid, uint256 time, address streamer, address artist) ;

  function stream(AppState state, string _cid) public returns (bytes) {
    require(state.userBalance >= state.streamingPrice, "user doesn't have enough balance");
    AppState memory ret = state;
    state.artistBalance += state.streamingPrice;
    state.userBalance -= state.streamingPrice;
    emit Stream(_cid, now, state.user, state.artist);
    return abi.encode(ret);
  }

  function resolve(AppState state, Transfer.Terms terms) public pure returns (Transfer.Transaction) {
    uint256[] memory amounts = new uint256[](2);
    amounts[0] = state.artistBalance;
    amounts[1] = state.userBalance;
    address[] memory to = new address[](2);
    to[0] = state.artist;
    to[1] = state.user;
    bytes[] memory data = new bytes[](2);
    return Transfer.Transaction(terms.assetType,terms.token,to,amounts,data);
  }

  function changeStreamingPrice(AppState state, uint256 newPrice) public view returns (bytes) {
    require(msg.sender == state.artist, "sender must be artist");
    AppState memory ret = state;
    state.streamingPrice = newPrice;
    return abi.encode(ret);
  }
}
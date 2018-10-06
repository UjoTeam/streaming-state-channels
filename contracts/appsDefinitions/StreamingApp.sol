pragma solidity 0.4.24;
pragma experimental "ABIEncoderV2";

import "../lib/Transfer.sol";


contract StreamingApp {

  enum ActionTypes {STREAM, CHANGEPRICE}

  enum TurnTakers {ARTIST, USER}

  struct Action {
    ActionTypes actionType;
    uint256 newPrice;
    string _cid;
  }

  struct AppState {
    address artist;
    address user;
    uint256 streamingPrice;
    uint256 artistBalance;
    uint256 userBalance;
    TurnTakers lastTurn;
  }


  
  function isStateTerminal(AppState state) public pure returns (bool) {
    return state.userBalance == 0;
  }
  
  function getTurnTaker(AppState state) public pure returns (uint256) {
    return uint256(state.lastTurn);
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

  function applyAction(AppState state, Action action) public view returns (bytes) {
    AppState memory newState;
    if (action.actionType == ActionTypes.STREAM) {
      require(state.userBalance >= state.streamingPrice, "user doesn't have enough balance");
      newState = state;
      state.artistBalance += state.streamingPrice;
      state.userBalance -= state.streamingPrice;
      state.lastTurn = TurnTakers.USER;
    } else if (action.actionType == ActionTypes.CHANGEPRICE) {
      require(msg.sender == state.artist, "sender must be artist");
      newState = state;
      state.streamingPrice = action.newPrice;
      state.lastTurn = TurnTakers.ARTIST;
    } else {
      revert("Invalid action type");
    }
    return abi.encode(newState);
  }

}
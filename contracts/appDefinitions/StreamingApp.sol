pragma solidity 0.4.24;
pragma experimental "ABIEncoderV2";

import "../lib/Transfer.sol";


contract StreamingApp {

  enum ActionTypes { STREAM}

  struct Action {
    ActionTypes actionType;
    uint256 _cid;
  }

  struct AppState {
    address user;
    address artist;
    uint256 totalTransfer;
    uint256 streamingPrice;
  }

  function isStateTerminal(AppState state)
    public
    pure
    returns (bool)
  {
    return true;
  }

  function getTurnTaker(AppState state)
    public
    pure
    returns (uint256)
  {
    return 0;
  }

  function resolve(AppState state, Transfer.Terms terms)
    public
    pure
    returns (Transfer.Transaction)
  {
    uint256[] memory amounts = new uint256[](2);
    amounts[0] = state.totalTransfer;
    amounts[1] = 0;

    address[] memory to = new address[](2);
    to[0] = state.user;
    to[1] = state.artist;
    bytes[] memory data = new bytes[](2);

    return Transfer.Transaction(
      terms.assetType,
      terms.token,
      to,
      amounts,
      data
    );
  }

  function applyAction(AppState state, Action action)
    public
    pure
    returns (bytes)
  {
    if (action.actionType == ActionTypes.STREAM) {
      return onStream(state, action);
    } else {
      revert("Invalid action type");
    }
  }

  function onStream(AppState state, Action inc)
    public
    pure
    returns (bytes)
  {
    AppState memory ret = state;
    state.totalTransfer += state.streamingPrice;
    return abi.encode(ret);
  }

}

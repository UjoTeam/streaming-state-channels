pragma solidity 0.4.24;

import "../lib/StaticCall.sol";


contract TestCaller {
  using StaticCall for address;

  function execStaticCall(
    address to,
    bytes4 selector,
    bytes calldata
  )
    public
    view
    returns (bytes)
  {
    bytes memory data = abi.encodePacked(selector, calldata);
    return to.staticcall_as_bytes(data);
  }

  function execStaticCallThree(
    address to, 
    bytes func,
    bytes appState,
    bytes action
  ) public view returns (bytes){
    bytes memory data = abi.encodePacked(func, appState, action);
    return to.staticcall_as_bytes(data);
  }

  function execCall(
    address to, 
    bytes func,
    bytes appState,
    bytes action
  ) public view returns (bytes) {
    bytes memory data = abi.encodePacked(func, appState, action);
    assembly {
      let result := call(gas, to,0, add(data, 0x20), mload(data), 0, 0)
      let size := returndatasize
      let ptr := mload(0x40)
      returndatacopy(ptr, 0, returndatasize)
      if eq(result, 0) { revert(ptr, returndatasize)}
      return(mload(0x40), returndatasize)
    }
  }

  function execStaticCallBool(
    address to,
    bytes4 selector,
    bytes calldata
  )
    public
    view
    returns (bool)
  {
    bytes memory data = abi.encodePacked(selector, calldata);
    return to.staticcall_as_bool(data);
  }

}

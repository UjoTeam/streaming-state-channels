import * as ethers from "ethers";

import * as Utils from "@counterfactual/test-utils";

const StreamingApp = artifacts.require("StreamingApp");

const web3 = (global as any).web3;
const { provider, unlockedAccount } = Utils.setupTestEnv(web3);

const [User, Artist] = [
  // 0xaeF082d339D227646DB914f0cA9fF02c8544F30b
  new ethers.Wallet(
    "0x3570f77380e22f8dc2274d8fd33e7830cc2d29cf76804e8c21f4f7a6cc571d27"
  ),
  // 0xb37e49bFC97A948617bF3B63BC6942BB15285715
  new ethers.Wallet(
    "0x4ccac8b1e81fb18a98bbaf29b9bfe307885561f71b76bd4680d7aec9d0ddfcfd"
  )
];

const computeStateHash = (stateHash: string, nonce: number, timeout: number) =>
  ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["bytes1", "address[]", "uint256", "uint256", "bytes32"],
      ["0x19", [User.address, Artist.address], nonce, timeout, stateHash]
    )
  );

const computeActionHash = (
  turn: string,
  prevState: string,
  action: string,
  setStateNonce: number,
  disputeNonce: number
) =>
  ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["bytes1", "address", "bytes32", "bytes", "uint256", "uint256"],
      ["0x19", turn, prevState, action, setStateNonce, disputeNonce]
    )
  );

contract("StreamingApp", (accounts: string[]) => {
  let st: ethers.Contract;
  let stateChannel: ethers.Contract;
  let testCaller: ethers.Contract;
  const exampleState = {
    user: User.address,
    artist: Artist.address,
    totalTransfer: 0,
    streamingPrice: Utils.UNIT_ETH
  };

  enum AssetType {
    ETH,
    ERC20,
    ANY
  }

  const encode = (encoding: string, state: any) =>
    ethers.utils.defaultAbiCoder.encode([encoding], [state]);

  const encodePacked = (encoding: string, state: any) =>
    ethers.utils.solidityPack([encoding], [state]);

  const latestNonce = async () => stateChannel.functions.latestNonce();

  // TODO: Wait for this to work:
  // ethers.utils.formatParamType(iface.functions.resolve.inputs[0])
  // github.com/ethers-io/ethers.js/blob/typescript/src.ts/utils/abi-coder.ts#L301
  const gameEncoding =
    "tuple(address user, address artist, uint256 totalTransfer, uint256 streamingPrice)";

  const appEncoding =
    "tuple(address addr, bytes4 applyAction, bytes4 resolve, bytes4 getTurnTaker, bytes4 isStateTerminal)";

  const termsEncoding = "tuple(uint8 assetType, uint256 limit, address token)";

  const { keccak256 } = ethers.utils;

  const sendSignedFinalizationToChain = async (stateHash: string) =>
    stateChannel.functions.setState(
      stateHash,
      await latestNonce(),
      0,
      Utils.signMessage(
        computeStateHash(
          stateHash || Utils.ZERO_BYTES32,
          await latestNonce(),
          0
        ),
        unlockedAccount
      )
    );

  let app;
  let terms;
  beforeEach(async () => {
    const StateChannel = artifacts.require("AppInstance");
    const StaticCall = artifacts.require("StaticCall");
    const Signatures = artifacts.require("Signatures");
    const Transfer = artifacts.require("Transfer");

    StreamingApp.link("StaticCall", StaticCall.address);

    st = await Utils.deployContract(StreamingApp, unlockedAccount);

    StateChannel.link("Signatures", Signatures.address);
    StateChannel.link("StaticCall", StaticCall.address);
    StateChannel.link("Transfer", Transfer.address);
    const TestCall = artifacts.require("TestCaller");
    TestCall.link("StaticCall", StaticCall.address);
    testCaller = await Utils.deployContract(TestCall, unlockedAccount);
    app = {
      addr: st.address,
      resolve: st.interface.functions.resolve.sighash,
      applyAction: st.interface.functions.applyAction.sighash,
      getTurnTaker: st.interface.functions.getTurnTaker.sighash,
      isStateTerminal: st.interface.functions.isStateTerminal.sighash
    };

    terms = {
      assetType: AssetType.ETH,
      limit: Utils.UNIT_ETH.mul(2),
      token: Utils.ZERO_ADDRESS
    };

    const contractFactory = new ethers.ContractFactory(
      StateChannel.abi,
      StateChannel.binary,
      unlockedAccount
    );

    stateChannel = await contractFactory.deploy(
      accounts[0],
      [User.address, Artist.address],
      keccak256(encode(appEncoding, app)),
      keccak256(encode(termsEncoding, terms)),
      10
    );
  });

  it("should resolve to some balance", async () => {
    const ret = await st.functions.resolve(exampleState, terms);
    ret.assetType.should.be.equal(AssetType.ETH);
    ret.token.should.be.equalIgnoreCase(Utils.ZERO_ADDRESS);
    ret.to[0].should.be.equalIgnoreCase(User.address);
    ret.to[1].should.be.equalIgnoreCase(Artist.address);
    ret.value[0].should.be.bignumber.eq(0);
    ret.value[1].should.be.bignumber.eq(0);
  });

  describe("setting a resolution", async () => {
    it("should fail before state is settled", async () => {
      const finalState = encode(gameEncoding, exampleState);
      await Utils.assertRejects(
        stateChannel.functions.setResolution(
          app,
          finalState,
          encode(termsEncoding, terms)
        )
      );
    });
    it("should succeed after state is settled", async () => {
      const finalState = encode(gameEncoding, exampleState);
      await sendSignedFinalizationToChain(keccak256(finalState));
      await stateChannel.functions.setResolution(
        app,
        finalState,
        encode(termsEncoding, terms)
      );
      const ret = await stateChannel.functions.getResolution();
      ret.assetType.should.be.equal(AssetType.ETH);
      ret.token.should.be.equalIgnoreCase(Utils.ZERO_ADDRESS);
      ret.to[0].should.be.equalIgnoreCase(User.address);
      ret.to[1].should.be.equalIgnoreCase(Artist.address);
      ret.value[0].should.be.bignumber.eq(0);
      ret.value[1].should.be.bignumber.eq(0);
    });
  });

  describe("handling a dispute", async () => {
    enum ActionTypes {
      STREAM
    }

    enum Status {
      ON,
      DISPUTE,
      OFF
    }

    const actionEncoding = "tuple(uint8 actionType, uint256 _cid)";

    const state = encode(gameEncoding, exampleState);

    const cid = "cid";
    const cidbytes = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(cid));
    it("should update state based on applyAction", async () => {
      const action = {
        actionType: ActionTypes.STREAM,
        _cid: cidbytes
      };

      const h1 = computeStateHash(keccak256(state), 1, 10);
      const h2 = computeActionHash(
        User.address,
        keccak256(state),
        encode(actionEncoding, action),
        1,
        0
      );

      await stateChannel.functions.createDispute(
        app,
        state,
        1,
        10,
        encode(actionEncoding, action),
        Utils.signMessage(h1, User, Artist),
        Utils.signMessage(h2, User),
        false
      );

      const onchain = await stateChannel.functions.state();

      const expectedState = { ...exampleState, totalTransfer: Utils.UNIT_ETH };
      const expectedStateHash = keccak256(encode(gameEncoding, expectedState));
      const expectedFinalizeBlock = (await provider.getBlockNumber()) + 10;

      onchain.status.should.be.bignumber.eq(Status.DISPUTE);
      onchain.appStateHash.should.be.equalIgnoreCase(expectedStateHash);
      onchain.latestSubmitter.should.be.equalIgnoreCase(accounts[0]);
      onchain.nonce.should.be.bignumber.eq(1);
      onchain.disputeNonce.should.be.bignumber.eq(0);
      onchain.disputeCounter.should.be.bignumber.eq(1);
      onchain.finalizesAt.should.be.bignumber.eq(expectedFinalizeBlock);
    });

    it("should update and finalize state based on applyAction", async () => {
      const action = {
        actionType: ActionTypes.STREAM,
        _cid: cidbytes
      };

      const h1 = computeStateHash(keccak256(state), 1, 10);
      const h2 = computeActionHash(
        User.address,
        keccak256(state),
        encode(actionEncoding, action),
        1,
        0
      );

      await stateChannel.functions.createDispute(
        app,
        state,
        1,
        10,
        encode(actionEncoding, action),
        Utils.signMessage(h1, User, Artist),
        Utils.signMessage(h2, User),
        true
      );

      const channelState = await stateChannel.functions.state();

      const expectedState = { ...exampleState, totalTransfer: Utils.UNIT_ETH };
      const expectedStateHash = keccak256(encode(gameEncoding, expectedState));
      const expectedFinalizeBlock = await provider.getBlockNumber();

      channelState.status.should.be.bignumber.eq(Status.OFF);
      channelState.appStateHash.should.be.equalIgnoreCase(expectedStateHash);
      channelState.latestSubmitter.should.be.equalIgnoreCase(accounts[0]);
      channelState.nonce.should.be.bignumber.eq(1);
      channelState.disputeNonce.should.be.bignumber.eq(0);
      channelState.disputeCounter.should.be.bignumber.eq(1);
      channelState.finalizesAt.should.be.bignumber.eq(expectedFinalizeBlock);
    });
  });
});

import * as ethers from "ethers";

import * as Utils from "@counterfactual/test-utils";

const StreamingApp = artifacts.require("StreamingApp");

const web3 = (global as any).web3;
const { provider, unlockedAccount } = Utils.setupTestEnv(web3);

const [Artist, User] = [
  // 0xb37e49bFC97A948617bF3B63BC6942BB15285715
  new ethers.Wallet(
    "0x4ccac8b1e81fb18a98bbaf29b9bfe307885561f71b76bd4680d7aec9d0ddfcfd"
  ),
  // 0xaeF082d339D227646DB914f0cA9fF02c8544F30b
  new ethers.Wallet(
    "0x3570f77380e22f8dc2274d8fd33e7830cc2d29cf76804e8c21f4f7a6cc571d27"
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
  let testSig: ethers.Contract;
  let testCaller: ethers.Contract;
  enum AssetType {
    ETH,
    ERC20,
    ANY
  }

  const exampleState = {
    artist: Artist.address,
    user: User.address,
    streamingPrice: Utils.UNIT_ETH,
    totalTransfer: 0
  };

  const encode = (encoding: string, state: any) =>
    ethers.utils.defaultAbiCoder.encode([encoding], [state]);

  const decode = (encoding: string, state: any) =>
    ethers.utils.defaultAbiCoder.decode([encoding], state);

  const latestNonce = async () => stateChannel.functions.latestNonce();

  const stEncoding =
    "tuple(address artist, address user, uint256 streamingPrice, uint256 totalTransfer)";

  const appEncoding =
    "tuple(address addr, bytes4 applyAction, bytes4 resolve, bytes4 getTurnTaker, bytes4 isStateTerminal)";

  const termsEncoding = "tuple(uint8 assetType, uint256 limit, address token)";

  const detailsEncoding =
    "tuple(uint8 assetType, address token, address[] to, uint256[] amount, bytes data)";

  const { keccak256 } = ethers.utils;

  const sendUpdateToChainWithNonce = (nonce: number, appState?: string) =>
    stateChannel.functions.setState(
      appState || Utils.ZERO_BYTES32,
      nonce,
      10,
      "0x"
    );

  const sendSignedUpdateToChainWithNonce = (nonce: number, appState?: string) =>
    stateChannel.functions.setState(
      appState || Utils.ZERO_BYTES32,
      nonce,
      10,
      Utils.signMessage(
        computeStateHash(appState || Utils.ZERO_BYTES32, nonce, 10),
        unlockedAccount
      )
    );

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
    st = await Utils.deployContract(StreamingApp, unlockedAccount);
    const StateChannel = artifacts.require("AppInstance");
    const StaticCall = artifacts.require("StaticCall");
    const Signatures = artifacts.require("Signatures");
    const Transfer = artifacts.require("Transfer");
    StateChannel.link("Signatures", Signatures.address);
    StateChannel.link("StaticCall", StaticCall.address);
    StateChannel.link("Transfer", Transfer.address);
    const TestSignatures = artifacts.require("TestSignatures");
    TestSignatures.link("Signatures", Signatures.address);
    const TestCall = artifacts.require("TestCaller");
    TestCall.link("StaticCall", StaticCall.address);
    testSig = await Utils.deployContract(TestSignatures, unlockedAccount);
    testCaller = await Utils.deployContract(TestCall, unlockedAccount);
    app = {
      addr: st.address,
      resolve: st.interface.functions.resolve.sighash,
      isStateTerminal: st.interface.functions.resolve.sighash,
      getTurnTaker: st.interface.functions.getTurnTaker.sighash,
      applyAction: st.interface.functions.applyAction.sighash
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

  it("should resolve to streaming", async () => {
    const ret = await st.functions.resolve(exampleState, terms);
    ret.assetType.should.be.equal(AssetType.ETH);
    ret.token.should.be.equalIgnoreCase(Utils.ZERO_ADDRESS);
    ret.to[0].should.be.equalIgnoreCase(Artist.address);
    ret.to[1].should.be.equalIgnoreCase(User.address);
    ret.value[0].should.be.bignumber.eq(0);
    ret.value[1].should.be.bignumber.eq(0);
  });

  describe("setting a resolution", async () => {
    it("should fail before state is settled", async () => {
      const finalState = encode(stEncoding, exampleState);
      await Utils.assertRejects(
        stateChannel.functions.setResolution(
          app,
          finalState,
          encode(termsEncoding, terms)
        )
      );
    });
    it("should succeed after state is settled", async () => {
      const finalState = encode(stEncoding, exampleState);
      await sendSignedFinalizationToChain(keccak256(finalState));
      await stateChannel.functions.setResolution(
        app,
        finalState,
        encode(termsEncoding, terms)
      );
      const ret = await stateChannel.functions.getResolution();
      ret.assetType.should.be.equal(AssetType.ETH);
      ret.token.should.be.equalIgnoreCase(Utils.ZERO_ADDRESS);
      ret.to[0].should.be.equalIgnoreCase(Artist.address);
      ret.to[1].should.be.equalIgnoreCase(User.address);
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

    const actionEncoding = "tuple(uint8 actionType, string _cid)";

    const state = encode(stEncoding, exampleState);

    it("should change state when streamed", async () => {
      const action = {
        actionType: ActionTypes.STREAM,
        _cid: "cid"
      };
      const ret = await st.functions.applyAction(exampleState, action);
      const dec = decode(stEncoding, ret);
      dec[0].totalTransfer.should.be.eql(Utils.UNIT_ETH);
    });

    it("should update state based on applyAction", async () => {
      const action = {
        actionType: ActionTypes.STREAM,
        _cid: "cid"
      };

      await testCaller.functions.execCall(
        app.addr,
        app.applyAction,
        state,
        encode(actionEncoding, action)
      );
      const h1 = computeStateHash(keccak256(state), 1, 10);
      // console.log(h1);
      // console.log(await stateChannel.functions.computeStateHash(keccak256(state), 1, 10));
      // console.log(Utils.signMessage(h1, Artist, User));
      // console.log(await testSig.functions.verify(Utils.signMessage(h1, Artist, User), h1, [User.address, Artist.address]));
      // console.log(await testSig.functions.recover(Utils.signMessage(h1, Artist, User), h1, 0));
      // console.log(await testSig.functions.recover(Utils.signMessage(h1, Artist, User), h1, 1));
      // console.log(User.address);
      // console.log(Artist.address);
      // console.log(await stateChannel.functions.getSigners());
      const h2 = computeActionHash(
        User.address,
        keccak256(state),
        encode(actionEncoding, action),
        1,
        0
      );

      // await stateChannel.functions.createDispute(
      //   app,
      //   state,
      //   1,
      //   10,
      //   encode(actionEncoding, action),
      //   Utils.signMessage(h1, Artist, User),
      //   Utils.signMessage(h2, User),
      //   false
      // );

      const onchain = await stateChannel.functions.state();

      const expectedState = {
        ...exampleState,
        totalTransfer: Utils.UNIT_ETH
      };
      const expectedStateHash = keccak256(encode(stEncoding, expectedState));
      const expectedFinalizeBlock = (await provider.getBlockNumber()) + 10;

      onchain.status.should.be.bignumber.eq(Status.DISPUTE);
      onchain.appStateHash.should.be.equalIgnoreCase(expectedStateHash);
      onchain.latestSubmitter.should.be.equalIgnoreCase(accounts[0]);
      onchain.nonce.should.be.bignumber.eq(1);
      onchain.disputeNonce.should.be.bignumber.eq(0);
      onchain.disputeCounter.should.be.bignumber.eq(1);
      onchain.finalizesAt.should.be.bignumber.eq(expectedFinalizeBlock);
    });
  });
});

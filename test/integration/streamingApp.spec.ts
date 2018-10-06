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

const getUpdateHash = (stateHash: string, nonce: number, timeout: number) =>
  ethers.utils.solidityKeccak256(
    ["bytes1", "address[]", "uint256", "uint256", "bytes32"],
    ["0x19", [Artist.address, User.address], nonce, timeout, stateHash]
  );

contract("StreamingApp", (accounts: string[]) => {
  let st: ethers.Contract;
  let stateChannel: ethers.Contract;

  enum AssetType {
    ETH,
    ERC20,
    ANY
  }

  const exampleState = {
    artist: Artist.address,
    user: User.address,
    streamingPrice: Utils.UNIT_ETH,
    artistBalance: 0,
    userBalance: Utils.UNIT_ETH.mul(5)
  };

  const encode = (encoding: string, state: any) =>
    ethers.utils.defaultAbiCoder.encode([encoding], [state]);

  const decode = (encoding: string, state: any) =>
    ethers.utils.defaultAbiCoder.decode([encoding], state);

  const latestNonce = async () => stateChannel.functions.latestNonce();

  const stEncoding =
    "tuple(address artist, address user, uint256 streamingPrice, uint256 artistBalance, uint256 userBalance)";

  const appEncoding =
    "tuple(address addr, bytes4 applyAction, bytes4 resolve, bytes4 getTurnTaker, bytes4 isStateTerminal)";

  const termsEncoding = "tuple(uint8 assetType, uint256 limit, address token)";

  const detailsEncoding =
    "tuple(uint8 assetType, address token, address[] to, uint256[] amount, bytes data)";

  const keccak256 = (bytes: string) =>
    ethers.utils.solidityKeccak256(["bytes"], [bytes]);

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
        getUpdateHash(appState || Utils.ZERO_BYTES32, nonce, 10),
        unlockedAccount
      )
    );

  const sendSignedFinalizationToChain = async (stateHash: string) =>
    stateChannel.functions.setState(
      stateHash,
      await latestNonce(),
      0,
      Utils.signMessage(
        getUpdateHash(stateHash || Utils.ZERO_BYTES32, await latestNonce(), 0),
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

    app = {
      addr: st.address,
      resolve: st.interface.functions.resolve.sighash,
      applyAction: "0x00000000",
      getTurnTaker: "0x00000000",
      isStateTerminal: "0x00000000"
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
      [Artist.address, User.address],
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
    ret.value[1].should.be.bignumber.eq(Utils.UNIT_ETH.mul(5));
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
      ret.value[1].should.be.bignumber.eq(Utils.UNIT_ETH.mul(5));
    });
  });
});
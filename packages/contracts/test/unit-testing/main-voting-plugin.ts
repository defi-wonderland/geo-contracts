import {
  DAO,
  DAO__factory,
  IDAO,
  MainVotingPlugin,
  MainVotingPlugin__factory,
  MemberAccessPlugin,
  MemberAccessPlugin__factory,
  SpacePlugin,
  SpacePlugin__factory,
} from '../../typechain';
import {ExecutedEvent} from '../../typechain/@aragon/osx/core/dao/DAO';
import {
  // ProposalCreatedEvent,
  ProposalExecutedEvent,
} from '../../typechain/src/governance/MainVotingPlugin';
import {
  deployWithProxy,
  findEvent,
  findEventTopicLog,
  toBytes32,
} from '../../utils/helpers';
import {deployTestDao} from '../helpers/test-dao';
import {
  ADDRESS_ONE,
  ADDRESS_THREE,
  ADDRESS_TWO,
  ADDRESS_ZERO,
  advanceAfterVoteEnd,
  advanceIntoVoteTime,
  EMPTY_DATA,
  EXECUTE_PERMISSION_ID,
  getTime, // MAX_UINT64,
  mineBlock,
  pctToRatio,
  ROOT_PERMISSION_ID,
  UPDATE_ADDRESSES_PERMISSION_ID,
  UPDATE_VOTING_SETTINGS_PERMISSION_ID,
  UPGRADE_PLUGIN_PERMISSION_ID,
  CONTENT_PERMISSION_ID,
  VoteOption,
  VotingMode,
  VotingSettings,
  ZERO_BYTES32,
  SUBSPACE_PERMISSION_ID,
  PAYER_PERMISSION_ID,
  PROPOSER_PERMISSION_ID,
} from './common';
import {defaultMainVotingSettings} from './common';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {toUtf8Bytes} from 'ethers/lib/utils';
import {ethers} from 'hardhat';

type InitData = {contentUri: string; metadata: string};
const mainVotingPluginInterface = MainVotingPlugin__factory.createInterface();
const spacePluginInterface = SpacePlugin__factory.createInterface();

describe('Main Voting Plugin', function () {
  let signers: SignerWithAddress[];
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dave: SignerWithAddress;
  let dao: DAO;
  let memberAccessPlugin: MemberAccessPlugin;
  let mainVotingPlugin: MainVotingPlugin;
  let spacePlugin: SpacePlugin;
  let defaultInput: InitData;

  before(async () => {
    signers = await ethers.getSigners();
    [alice, bob, carol, dave] = signers;
    dao = await deployTestDao(alice);

    defaultInput = {contentUri: 'ipfs://', metadata: '0x'};
  });

  beforeEach(async () => {
    memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
      new MemberAccessPlugin__factory(alice)
    );
    mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
      new MainVotingPlugin__factory(alice)
    );
    spacePlugin = await deployWithProxy<SpacePlugin>(
      new SpacePlugin__factory(alice)
    );

    // inits
    await memberAccessPlugin.initialize(dao.address, {
      proposalDuration: 60 * 60 * 24 * 5,
    });
    await mainVotingPlugin.initialize(
      dao.address,
      defaultMainVotingSettings,
      [alice.address],
      memberAccessPlugin.address
    );
    await spacePlugin.initialize(
      dao.address,
      defaultInput.contentUri,
      defaultInput.metadata,
      ADDRESS_ZERO
    );

    // The plugin can execute on the DAO
    await dao.grant(
      dao.address,
      mainVotingPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // MemberAccessPlugin can execute on the DAO
    await dao.grant(
      dao.address,
      memberAccessPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // The DAO can add/remove editors
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPDATE_ADDRESSES_PERMISSION_ID
    );
    // The DAO can update the plugin settings
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPDATE_VOTING_SETTINGS_PERMISSION_ID
    );
    // The DAO can upgrade the plugin
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPGRADE_PLUGIN_PERMISSION_ID
    );
    // The DAO can publish edits on the Space
    await dao.grant(spacePlugin.address, dao.address, CONTENT_PERMISSION_ID);
    // The DAO can manage subspaces on the Space
    await dao.grant(spacePlugin.address, dao.address, SUBSPACE_PERMISSION_ID);
    // The DAO can set the payer on the Space
    await dao.grant(spacePlugin.address, dao.address, PAYER_PERMISSION_ID);
    // The DAO is ROOT on itself
    await dao.grant(dao.address, dao.address, ROOT_PERMISSION_ID);
    // The plugin can propose members on the member access helper
    await dao.grant(
      memberAccessPlugin.address,
      mainVotingPlugin.address,
      PROPOSER_PERMISSION_ID
    );
    // Alice can make the DAO execute arbitrary stuff (test)
    await dao.grant(dao.address, alice.address, EXECUTE_PERMISSION_ID);

    // Alice is already an editor (see initialize)

    // Bob is a member
    await mainVotingPlugin.proposeAddMember('0x', bob.address);
  });

  describe('initialize', async () => {
    it('reverts if trying to re-initialize', async () => {
      await expect(
        mainVotingPlugin.initialize(
          dao.address,
          defaultMainVotingSettings,
          [alice.address],
          memberAccessPlugin.address
        )
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Fails to initialize with an incompatible main voting plugin', async () => {
      // ok
      mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
        new MainVotingPlugin__factory(alice)
      );
      await expect(
        mainVotingPlugin.initialize(
          dao.address,
          defaultMainVotingSettings,
          [alice.address],
          memberAccessPlugin.address
        )
      ).to.not.be.reverted;

      // not ok
      mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
        new MainVotingPlugin__factory(alice)
      );
      await expect(
        mainVotingPlugin.initialize(
          dao.address,
          defaultMainVotingSettings,
          [alice.address],
          bob.address
        )
      ).to.be.reverted;

      // not ok
      mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
        new MainVotingPlugin__factory(alice)
      );
      await expect(
        mainVotingPlugin.initialize(
          dao.address,
          defaultMainVotingSettings,
          [alice.address],
          spacePlugin.address
        )
      ).to.be.reverted;
    });

    it('The plugin has one editor after created', async () => {
      // Alice
      mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
        new MainVotingPlugin__factory(alice)
      );
      await mainVotingPlugin.initialize(
        dao.address,
        defaultMainVotingSettings,
        [alice.address],
        memberAccessPlugin.address
      );
      await mineBlock();

      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);
      expect(await mainVotingPlugin.totalVotingPower(0)).to.eq(0);
      expect(
        await mainVotingPlugin.totalVotingPower(
          (await ethers.provider.getBlockNumber()) - 1
        )
      ).to.eq(1);

      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.true;
      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.false;

      // Bob
      mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
        new MainVotingPlugin__factory(alice)
      );
      await mainVotingPlugin.initialize(
        dao.address,
        defaultMainVotingSettings,
        [bob.address],
        memberAccessPlugin.address
      );
      await mineBlock();

      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);
      expect(await mainVotingPlugin.totalVotingPower(0)).to.eq(0);
      expect(
        await mainVotingPlugin.totalVotingPower(
          (await ethers.provider.getBlockNumber()) - 1
        )
      ).to.eq(1);

      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.false;
      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.true;
    });
  });

  context('Before proposals', () => {
    it('Voting on a non-created proposal reverts', async () => {
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);

      await expect(mainVotingPlugin.vote(0, VoteOption.Yes, false)).to.be
        .reverted;
      await expect(mainVotingPlugin.vote(10, VoteOption.No, false)).to.be
        .reverted;
      await expect(mainVotingPlugin.vote(50, VoteOption.Abstain, false)).to.be
        .reverted;
      await expect(mainVotingPlugin.vote(500, VoteOption.None, false)).to.be
        .reverted;

      await expect(mainVotingPlugin.vote(0, VoteOption.Yes, true)).to.be
        .reverted;
      await expect(mainVotingPlugin.vote(1, VoteOption.No, true)).to.be
        .reverted;
      await expect(mainVotingPlugin.vote(2, VoteOption.Abstain, true)).to.be
        .reverted;
      await expect(mainVotingPlugin.vote(3, VoteOption.None, true)).to.be
        .reverted;
    });

    it('Only members can create proposals', async () => {
      await expect(
        mainVotingPlugin.connect(alice).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      await expect(
        mainVotingPlugin.connect(carol).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(carol.address);

      await expect(
        mainVotingPlugin.connect(dave).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(dave.address);
    });

    it('Only members can call proposal creation wrappers', async () => {
      expect(await mainVotingPlugin.isMember(alice.address)).to.be.true;
      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.true;

      expect(await mainVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(0)
      );

      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeEdits(
            toUtf8Bytes('ipfs://meta'),
            'ipfs://edits',
            toUtf8Bytes('ipfs://edits-meta'),
            spacePlugin.address
          )
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(1)
      );

      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeFlagContent(
            toUtf8Bytes('ipfs://meta'),
            'ipfs://flag',
            spacePlugin.address
          )
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(2)
      );

      expect(await mainVotingPlugin.isMember(bob.address)).to.be.true;
      await expect(
        mainVotingPlugin
          .connect(bob)
          .proposeAcceptSubspace(
            toUtf8Bytes('ipfs://meta-2'),
            ADDRESS_THREE,
            spacePlugin.address
          )
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(3)
      );

      await expect(
        mainVotingPlugin
          .connect(bob)
          .proposeRemoveSubspace(
            toUtf8Bytes('ipfs://more-meta-here'),
            bob.address,
            spacePlugin.address
          )
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(4)
      );

      await expect(
        mainVotingPlugin
          .connect(bob)
          .proposeSetPayer(
            toUtf8Bytes('ipfs://meta-3'),
            bob.address,
            spacePlugin.address
          )
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(5)
      );

      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeEdits(
            toUtf8Bytes('ipfs://meta'),
            'ipfs://edits',
            toUtf8Bytes('ipfs://edits-meta'),
            spacePlugin.address
          )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(carol.address);

      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeFlagContent(
            toUtf8Bytes('ipfs://meta'),
            'ipfs://flag',
            spacePlugin.address
          )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(carol.address);

      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAcceptSubspace(
            toUtf8Bytes('ipfs://'),
            ADDRESS_THREE,
            spacePlugin.address
          )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(dave.address);

      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeRemoveSubspace(
            toUtf8Bytes('ipfs://'),
            ADDRESS_ONE,
            spacePlugin.address
          )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(dave.address);

      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeSetPayer(
            toUtf8Bytes('ipfs://'),
            ADDRESS_TWO,
            spacePlugin.address
          )
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'NotAMember')
        .withArgs(dave.address);
    });

    it('Only editors can vote on proposals', async () => {
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      let proposal = await mainVotingPlugin.getProposal(0);
      expect(proposal.executed).to.eq(false);

      // Bob can't vote
      await expect(mainVotingPlugin.connect(bob).vote(0, VoteOption.Yes, false))
        .to.be.reverted;

      // Carol can't vote
      await expect(
        mainVotingPlugin.connect(carol).vote(0, VoteOption.Yes, false)
      ).to.be.reverted;

      // Dave can't vote
      await expect(
        mainVotingPlugin.connect(dave).vote(0, VoteOption.Yes, false)
      ).to.be.reverted;

      proposal = await mainVotingPlugin.getProposal(0);
      expect(proposal.executed).to.eq(false);

      // Alice can vote
      await expect(mainVotingPlugin.vote(0, VoteOption.Yes, true)).to.not.be
        .reverted;

      proposal = await mainVotingPlugin.getProposal(0);
      expect(proposal.executed).to.eq(true);
    });

    it('Only editors can vote when creating proposals', async () => {
      expect(await mainVotingPlugin.isEditor(bob.address)).to.eq(false);

      // Bob can't create and vote
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.be.reverted;

      // Bob can create without voting
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      // Alice can create and vote
      await expect(
        mainVotingPlugin.connect(alice).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      // Alice can create without a vote
      await expect(
        mainVotingPlugin.connect(alice).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;
    });

    it('isMember() returns true when appropriate', async () => {
      expect(await mainVotingPlugin.isMember(ADDRESS_ZERO)).to.eq(false);
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(false);

      expect(await mainVotingPlugin.isMember(alice.address)).to.eq(true);
      expect(await mainVotingPlugin.isMember(bob.address)).to.eq(true);

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      await mainVotingPlugin.proposeAddMember('0x', carol.address);
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(true);

      await mainVotingPlugin.proposeRemoveMember('0x', carol.address);
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      await makeEditor(carol.address);

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(true);
    });

    it('isEditor() returns true when appropriate', async () => {
      expect(await mainVotingPlugin.isEditor(ADDRESS_ZERO)).to.eq(false);
      expect(await mainVotingPlugin.isEditor(ADDRESS_ONE)).to.eq(false);
      expect(await mainVotingPlugin.isEditor(ADDRESS_TWO)).to.eq(false);

      expect(await mainVotingPlugin.isEditor(alice.address)).to.eq(true);
      expect(await mainVotingPlugin.isEditor(bob.address)).to.eq(false);
      expect(await mainVotingPlugin.isEditor(carol.address)).to.eq(false);

      await makeEditor(carol.address);

      expect(await mainVotingPlugin.isEditor(carol.address)).to.eq(true);
    });
  });

  context('One editor', () => {
    it('Proposals take immediate effect when created by the only editor', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      await expect(
        mainVotingPlugin.createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      const proposal = await mainVotingPlugin.getProposal(0);
      expect(proposal.executed).to.eq(true);
    });

    it("Proposals created by a member require the editor's vote", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      const proposal = await mainVotingPlugin.getProposal(0);
      expect(proposal.executed).to.eq(false);
    });
  });

  context('Multiple editors', () => {
    it('Proposals created by a member require editor votes', async () => {
      let pid = 0;
      // Carol member
      await mainVotingPlugin.proposeAddMember('0x', carol.address);
      // Bob editor
      await proposeNewEditor(bob.address);

      await expect(createDummyProposal(carol, false)).to.not.be.reverted;
      pid++;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol tries to vote
      await expect(
        mainVotingPlugin.connect(carol).vote(pid, VoteOption.Yes, true)
      ).to.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Alice votes
      await expect(mainVotingPlugin.vote(pid, VoteOption.Yes, false)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Bob votes
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.Yes, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(true);
    });

    it('Proposals created by an editor require additional votes', async () => {
      let pid = 0;
      // Bob and Carol editors
      await proposeNewEditor(bob.address);
      await proposeNewEditor(carol.address);
      pid++;
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.Yes, true)
      ).to.not.be.reverted;

      // Proposal 1
      await expect(createDummyProposal(alice, false)).to.not.be.reverted;
      pid++;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Alice votes
      await expect(mainVotingPlugin.vote(pid, VoteOption.Yes, false)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Bob votes (66% yes)
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.Yes, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(true);

      // Proposal 2
      await expect(createDummyProposal(alice, true)).to.not.be.reverted;
      pid++;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Bob votes (66% yes)
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.Yes, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(true);
    });

    it("At least an editor who didn't create the proposal must vote", async () => {
      let pid: number;
      // Alice, Bob and Carol: editors
      await proposeNewEditor(bob.address);
      await proposeNewEditor(carol.address);
      pid = (await mainVotingPlugin.proposalCount()).toNumber() - 1;
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.Yes, true)
      ).to.not.be.reverted;

      // Proposal 1
      await expect(createDummyProposal(alice, false)).to.not.be.reverted;
      pid++;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Alice votes Yes
      await expect(mainVotingPlugin.vote(pid, VoteOption.Yes, false)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Bob votes No (50/50)
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.No, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol votes Yes (66% yes)
      await expect(
        mainVotingPlugin.connect(carol).vote(pid, VoteOption.Yes, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(true);

      // Proposal 2
      await expect(createDummyProposal(alice, true)).to.not.be.reverted;
      pid++;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Bob votes (66% yes)
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.Yes, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(true);
    });
  });

  context('Proposal wrappers', () => {
    it('proposeEdits creates a proposal with the right values', async () => {
      let pid = 0;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeEdits(
          toUtf8Bytes('ipfs://metadata'),
          'ipfs://edits-uri',
          toUtf8Bytes('ipfs://edits-metadata'),
          spacePlugin.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(spacePlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('publishEdits', [
          'ipfs://edits-uri',
          toUtf8Bytes('ipfs://edits-metadata'),
        ])
      );

      // 2
      pid++;

      await expect(
        mainVotingPlugin.proposeEdits(
          toUtf8Bytes('ipfs://more-metadata-here'),
          'ipfs://more-edits-uri',
          toUtf8Bytes('ipfs://more-edits-metadata-here'),
          '0x5555555555666666666677777777778888888888'
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(
        '0x5555555555666666666677777777778888888888'
      );
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('publishEdits', [
          'ipfs://more-edits-uri',
          toUtf8Bytes('ipfs://more-edits-metadata-here'),
        ])
      );
    });

    it('proposeFlagContent creates a proposal with the right values', async () => {
      let pid = 0;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeFlagContent(
          toUtf8Bytes('ipfs://metadata'),
          'ipfs://flag-uri',
          spacePlugin.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(spacePlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('flagContent', [
          'ipfs://flag-uri',
        ])
      );

      // 2
      pid++;

      await expect(
        mainVotingPlugin.proposeFlagContent(
          toUtf8Bytes('ipfs://more-metadata-here'),
          'ipfs://more-flag-uri',
          '0x5555555555666666666677777777778888888888'
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(
        '0x5555555555666666666677777777778888888888'
      );
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('flagContent', [
          'ipfs://more-flag-uri',
        ])
      );
    });

    it('proposeAcceptSubspace creates a proposal with the right values', async () => {
      let pid = 0;
      let newSubspacePluginAddress =
        '0x1234567890123456789012345678901234567890';

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeAcceptSubspace(
          toUtf8Bytes('ipfs://'),
          newSubspacePluginAddress,
          spacePlugin.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(spacePlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('acceptSubspace', [
          newSubspacePluginAddress,
        ])
      );

      // 2
      pid++;
      newSubspacePluginAddress = '0x0123456789012345678901234567890123456789';

      await expect(
        mainVotingPlugin.proposeAcceptSubspace(
          toUtf8Bytes('ipfs://more-data-here'),
          newSubspacePluginAddress,
          '0x5555555555666666666677777777778888888888'
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(
        '0x5555555555666666666677777777778888888888'
      );
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('acceptSubspace', [
          newSubspacePluginAddress,
        ])
      );
    });

    it('proposeRemoveSubspace creates a proposal with the right values', async () => {
      let pid = 0;
      let subspaceToRemove = '0x1234567890123456789012345678901234567890';

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeRemoveSubspace(
          toUtf8Bytes('ipfs://'),
          subspaceToRemove,
          spacePlugin.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(spacePlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('removeSubspace', [
          subspaceToRemove,
        ])
      );

      // 2
      pid++;
      subspaceToRemove = '0x0123456789012345678901234567890123456789';

      await expect(
        mainVotingPlugin.proposeRemoveSubspace(
          toUtf8Bytes('ipfs://more-data-here'),
          subspaceToRemove,
          '0x5555555555666666666677777777778888888888'
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(
        '0x5555555555666666666677777777778888888888'
      );
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('removeSubspace', [
          subspaceToRemove,
        ])
      );
    });

    it('proposeAddMember creates a proposal on the MemberAccessPlugin', async () => {
      let msPid = 1;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      expect((await memberAccessPlugin.proposalCount()).toNumber()).to.eq(1);
      await expect(
        mainVotingPlugin.proposeAddMember(
          toUtf8Bytes('ipfs://meta'),
          carol.address
        )
      ).to.not.be.reverted;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      expect((await memberAccessPlugin.proposalCount()).toNumber()).to.eq(2);

      let proposal = await memberAccessPlugin.getProposal(msPid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('addMember', [
          carol.address,
        ])
      );

      // 2
      msPid++;
      await expect(
        mainVotingPlugin.proposeAddMember(
          toUtf8Bytes('ipfs://more-meta'),
          ADDRESS_THREE
        )
      ).to.not.be.reverted;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      expect((await memberAccessPlugin.proposalCount()).toNumber()).to.eq(3);

      proposal = await memberAccessPlugin.getProposal(msPid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('addMember', [
          ADDRESS_THREE,
        ])
      );
    });

    it('proposeRemoveMember creates a proposal with the right values', async () => {
      let pid = 0;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeRemoveMember(
          toUtf8Bytes('ipfs://meta'),
          alice.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('removeMember', [
          alice.address,
        ])
      );

      // 2
      pid++;

      await expect(
        mainVotingPlugin.proposeRemoveMember(
          toUtf8Bytes('ipfs://more-meta'),
          bob.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('removeMember', [
          bob.address,
        ])
      );
    });

    it('proposeAddEditor creates a proposal with the right values', async () => {
      let pid = 0;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeAddEditor(
          toUtf8Bytes('ipfs://meta'),
          carol.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('addEditor', [
          carol.address,
        ])
      );

      // 2
      pid++;

      await expect(
        mainVotingPlugin.proposeAddEditor(
          toUtf8Bytes('ipfs://more-meta'),
          bob.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('addEditor', [bob.address])
      );
    });

    it('proposeRemoveEditor creates a proposal with the right values', async () => {
      let pid = 0;
      await makeEditor(bob.address);

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeRemoveEditor(
          toUtf8Bytes('ipfs://meta'),
          alice.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('removeEditor', [
          alice.address,
        ])
      );

      // 2
      pid++;

      await expect(
        mainVotingPlugin.proposeRemoveEditor(
          toUtf8Bytes('ipfs://more-meta'),
          bob.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('removeEditor', [
          bob.address,
        ])
      );
    });

    it('proposeSetPayer creates a proposal with the right values', async () => {
      let pid = 0;

      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(0);
      await expect(
        mainVotingPlugin.proposeSetPayer(
          toUtf8Bytes('ipfs://metadata'),
          alice.address,
          spacePlugin.address
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(1);

      let proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(spacePlugin.address);
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('setPayer', [alice.address])
      );

      // 2
      pid++;

      await expect(
        mainVotingPlugin.proposeSetPayer(
          toUtf8Bytes('ipfs://more-metadata-here'),
          bob.address,
          '0x5555555555666666666677777777778888888888'
        )
      ).to.not.be.reverted;
      expect((await mainVotingPlugin.proposalCount()).toNumber()).to.eq(2);

      proposal = await mainVotingPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(
        '0x5555555555666666666677777777778888888888'
      );
      expect(proposal.actions[0].value.toNumber()).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        spacePluginInterface.encodeFunctionData('setPayer', [bob.address])
      );
    });
  });

  context('Canceling', () => {
    it('Proposals created by a member can be canceled before they end', async () => {
      const proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      // Bob cancels
      await expect(mainVotingPlugin.connect(bob).cancelProposal(proposalId)).to
        .not.be.reverted;

      // No more votes
      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;
      await expect(
        mainVotingPlugin.connect(alice).vote(proposalId, VoteOption.Yes, false)
      ).to.be.reverted;
    });

    it('Proposals created by an editor can be canceled before they end', async () => {
      await makeEditor(bob.address);
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);

      const proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      // Bob cancels
      await expect(mainVotingPlugin.connect(bob).cancelProposal(proposalId)).to
        .not.be.reverted;

      // No more votes
      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;
      await expect(
        mainVotingPlugin.connect(alice).vote(proposalId, VoteOption.Yes, false)
      ).to.be.reverted;
    });

    it('Canceling a proposal emits an event', async () => {
      let proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      // Bob cancels
      await expect(mainVotingPlugin.connect(bob).cancelProposal(proposalId))
        .to.to.emit(mainVotingPlugin, 'ProposalCanceled')
        .withArgs(proposalId);

      // New proposal
      proposalId = 1;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      // Bob cancels
      await expect(mainVotingPlugin.connect(bob).cancelProposal(proposalId))
        .to.to.emit(mainVotingPlugin, 'ProposalCanceled')
        .withArgs(proposalId);
    });

    it('Proposals cannot be canceled after they end (member created)', async () => {
      let proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      let proposal = await mainVotingPlugin.getProposal(proposalId);
      await advanceAfterVoteEnd(proposal.parameters.endDate.toNumber());

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;

      // Bob cannot cancel
      await expect(
        mainVotingPlugin.connect(bob).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'ProposalIsNotOpen');

      proposal = await mainVotingPlugin.getProposal(proposalId);
      expect(proposal.executed).to.be.false;

      // New proposal (to be approved)

      proposalId = 1;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      // Alice approves and executes
      await expect(
        mainVotingPlugin.connect(alice).vote(proposalId, VoteOption.Yes, true)
      ).to.not.be.reverted;

      proposal = await mainVotingPlugin.getProposal(proposalId);
      expect(proposal.executed).to.be.true;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;

      // Bob cannot cancel
      await expect(
        mainVotingPlugin.connect(bob).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'ProposalIsNotOpen');
    });

    it('Proposals cannot be canceled after they end (editor created)', async () => {
      await makeEditor(bob.address);
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);

      let proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      let proposal = await mainVotingPlugin.getProposal(proposalId);
      await advanceAfterVoteEnd(proposal.parameters.endDate.toNumber());

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;

      // Bob cannot cancel
      await expect(
        mainVotingPlugin.connect(bob).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'ProposalIsNotOpen');

      proposal = await mainVotingPlugin.getProposal(proposalId);
      expect(proposal.executed).to.be.false;

      // New proposal (to be approved)

      proposalId = 1;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      // Alice approves and executes
      await expect(
        mainVotingPlugin.connect(alice).vote(proposalId, VoteOption.Yes, true)
      ).to.not.be.reverted;

      proposal = await mainVotingPlugin.getProposal(proposalId);
      expect(proposal.executed).to.be.true;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;

      // Bob cannot cancel
      await expect(
        mainVotingPlugin.connect(bob).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'ProposalIsNotOpen');
    });

    it('Proposals can only be canceled by the creator (member)', async () => {
      const proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.None,
          true // auto execute
        )
      ).to.not.be.reverted;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      // They cannot cancel
      await expect(
        mainVotingPlugin.connect(alice).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'OnlyCreatorCanCancel');
      await expect(
        mainVotingPlugin.connect(carol).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'OnlyCreatorCanCancel');
      await expect(
        mainVotingPlugin.connect(dave).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'OnlyCreatorCanCancel');

      // Still open
      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      // Bob can cancel
      await expect(mainVotingPlugin.connect(bob).cancelProposal(proposalId)).to
        .not.be.reverted;

      // No more votes
      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;
      await expect(
        mainVotingPlugin.connect(alice).vote(proposalId, VoteOption.Yes, false)
      ).to.be.reverted;
    });

    it('Proposals can only be canceled by the creator (editor)', async () => {
      await makeEditor(bob.address);
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);

      const proposalId = 0;
      await expect(
        mainVotingPlugin.connect(bob).createProposal(
          toUtf8Bytes('ipfs://'),
          [],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      ).to.not.be.reverted;

      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      // They cannot cancel
      await expect(
        mainVotingPlugin.connect(alice).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'OnlyCreatorCanCancel');
      await expect(
        mainVotingPlugin.connect(carol).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'OnlyCreatorCanCancel');
      await expect(
        mainVotingPlugin.connect(dave).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(mainVotingPlugin, 'OnlyCreatorCanCancel');

      // Still open
      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.true;

      // Bob can cancel
      await expect(mainVotingPlugin.connect(bob).cancelProposal(proposalId)).to
        .not.be.reverted;

      // No more votes
      expect(
        await mainVotingPlugin.canVote(
          proposalId,
          alice.address,
          VoteOption.Yes
        )
      ).to.be.false;
      await expect(
        mainVotingPlugin.connect(alice).vote(proposalId, VoteOption.Yes, false)
      ).to.be.reverted;
    });
  });

  context('After proposals', () => {
    it('Adding an editor increases the editorCount', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      // Add Bob
      await proposeNewEditor(bob.address);
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);
      expect(await mainVotingPlugin.isEditor(bob.address)).to.eq(true);

      // Propose Carol
      await proposeNewEditor(carol.address);
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);
      expect(await mainVotingPlugin.isEditor(carol.address)).to.eq(false);

      // Confirm Carol
      await expect(mainVotingPlugin.connect(bob).vote(1, VoteOption.Yes, true))
        .to.not.be.reverted;
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);
      expect(await mainVotingPlugin.isEditor(carol.address)).to.eq(true);
    });

    it('Removing an editor decreases the editorCount', async () => {
      // Add Bob and Carol
      await proposeNewEditor(bob.address); // Alice votes yes as the creator
      await proposeNewEditor(carol.address); // Alice votes yes as the creator
      await expect(mainVotingPlugin.connect(bob).vote(1, VoteOption.Yes, true))
        .to.not.be.reverted;
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Propose removing Carol
      await proposeRemoveEditor(carol.address); // Alice votes yes as the creator
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);
      await expect(mainVotingPlugin.connect(bob).vote(2, VoteOption.Yes, true))
        .to.not.be.reverted;
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);

      // Propose removing Bob
      await proposeRemoveEditor(bob.address);
      await expect(mainVotingPlugin.connect(bob).vote(3, VoteOption.Yes, true))
        .to.not.be.reverted;
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);
    });

    it('Attempting to remove the last editor reverts', async () => {
      // Try to remove Alice
      await expect(pullEditor(alice.address)).to.be.revertedWithCustomError(
        mainVotingPlugin,
        'NoEditorsLeft'
      );
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      // Add Bob
      await proposeNewEditor(bob.address);
      expect(await mainVotingPlugin.addresslistLength()).to.eq(2);
      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.true;
      await mineBlock();

      // Remove Bob
      await expect(proposeRemoveEditor(bob.address)).to.not.be.reverted;
      await expect(mainVotingPlugin.connect(bob).vote(1, VoteOption.Yes, true))
        .to.not.be.reverted;
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      // Try to remove Alice
      await expect(pullEditor(alice.address)).to.be.revertedWithCustomError(
        mainVotingPlugin,
        'NoEditorsLeft'
      );
    });

    it('Attempting to vote twice fails (replacement disabled)', async () => {
      // Add Bob
      await proposeNewEditor(bob.address); // Alice votes yes as the creator

      // Propose Carol
      await proposeNewEditor(carol.address); // Alice votes yes as the creator

      // Vote again
      await expect(
        mainVotingPlugin.connect(alice).vote(1, VoteOption.Yes, true)
      ).to.be.reverted;
    });

    it('Approved proposals can be executed by anyone after passed', async () => {
      const pid = 0;
      await expect(createDummyProposal(bob, false)).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol cannot execute
      await expect(mainVotingPlugin.connect(carol).execute(pid)).to.be.reverted;

      // Alice approves
      await expect(mainVotingPlugin.vote(pid, VoteOption.Yes, false)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(true);

      // Carol executes
      await expect(mainVotingPlugin.connect(carol).execute(pid)).to.not.be
        .reverted;
    });

    it('Rejected proposals cannot be executed', async () => {
      let pid = 0;
      await expect(createDummyProposal(bob, false)).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol cannot execute
      await expect(mainVotingPlugin.connect(carol).execute(pid)).to.be.reverted;

      // Alice rejects
      await expect(mainVotingPlugin.vote(pid, VoteOption.No, false)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol cannot execute
      await expect(mainVotingPlugin.connect(carol).execute(pid)).to.be.reverted;

      //

      // Now with Bob as editor
      await proposeNewEditor(bob.address); // Alice auto approves
      pid++;
      await expect(createDummyProposal(bob, false)).to.not.be.reverted;
      pid++;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol cannot execute
      await expect(mainVotingPlugin.connect(carol).execute(pid)).to.be.reverted;

      // Alice rejects
      await expect(mainVotingPlugin.vote(pid, VoteOption.No, false)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Bob rejects
      await expect(
        mainVotingPlugin.connect(bob).vote(pid, VoteOption.No, false)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.canExecute(pid)).to.eq(false);

      // Carol cannot execute
      await expect(mainVotingPlugin.connect(carol).execute(pid)).to.be.reverted;
    });

    it('The DAO can update the settings', async () => {
      await expect(
        mainVotingPlugin.createProposal(
          toUtf8Bytes('ipfs://'),
          [
            {
              to: mainVotingPlugin.address,
              value: 0,
              data: mainVotingPluginInterface.encodeFunctionData(
                'updateVotingSettings',
                [
                  {
                    votingMode: 0,
                    supportThreshold: 12345,
                    duration: 60 * 60 * 3,
                  },
                ]
              ),
            },
          ],
          0, // fail safe
          VoteOption.Yes,
          true // auto execute
        )
      )
        .to.emit(mainVotingPlugin, 'VotingSettingsUpdated')
        .withArgs(0, 12345, 60 * 60 * 3);
    });

    it('The DAO can add editors', async () => {
      // Nobody else can
      await expect(mainVotingPlugin.connect(alice).addEditor(bob.address)).to.be
        .reverted;
      await expect(mainVotingPlugin.connect(bob).addEditor(bob.address)).to.be
        .reverted;
      await expect(mainVotingPlugin.connect(carol).addEditor(dave.address)).to
        .be.reverted;
      await expect(mainVotingPlugin.connect(dave).addEditor(dave.address)).to.be
        .reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: mainVotingPlugin.address,
          value: 0,
          data: mainVotingPluginInterface.encodeFunctionData('addEditor', [
            dave.address,
          ]),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });

    it('The DAO can remove editors', async () => {
      await makeEditor(bob.address);

      // Nobody else can
      await expect(mainVotingPlugin.connect(alice).removeEditor(bob.address)).to
        .be.reverted;
      await expect(mainVotingPlugin.connect(bob).removeEditor(bob.address)).to
        .be.reverted;
      await expect(mainVotingPlugin.connect(carol).removeEditor(bob.address)).to
        .be.reverted;
      await expect(mainVotingPlugin.connect(dave).removeEditor(bob.address)).to
        .be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: mainVotingPlugin.address,
          value: 0,
          data: mainVotingPluginInterface.encodeFunctionData('removeEditor', [
            bob.address,
          ]),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });

    it('The DAO can upgrade the plugin', async () => {
      // Nobody else can
      await expect(mainVotingPlugin.connect(alice).upgradeTo(ADDRESS_ONE)).to.be
        .reverted;
      await expect(mainVotingPlugin.connect(bob).upgradeTo(ADDRESS_ONE)).to.be
        .reverted;
      await expect(
        mainVotingPlugin.connect(carol).upgradeToAndCall(
          mainVotingPlugin.implementation(), // upgrade to itself
          EMPTY_DATA
        )
      ).to.be.reverted;
      await expect(
        mainVotingPlugin.connect(dave).upgradeToAndCall(
          mainVotingPlugin.implementation(), // upgrade to itself
          EMPTY_DATA
        )
      ).to.be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: mainVotingPlugin.address,
          value: 0,
          data: mainVotingPluginInterface.encodeFunctionData('upgradeTo', [
            await mainVotingPlugin.implementation(),
          ]),
        },
        {
          to: mainVotingPlugin.address,
          value: 0,
          data: mainVotingPluginInterface.encodeFunctionData(
            'supportsInterface',
            ['0x12345678']
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });
  });

  context('Joining a space via MemberAccessPlugin', () => {
    it('Proposing new members via MemberAccess plugin grants membership', async () => {
      expect(await mainVotingPlugin.isMember(carol.address)).to.be.false;
      await mainVotingPlugin.proposeAddMember(
        toUtf8Bytes('ipfs://'),
        carol.address
      );
      expect(await mainVotingPlugin.isMember(carol.address)).to.be.true;

      // 2
      expect(await mainVotingPlugin.isMember(ADDRESS_THREE)).to.be.false;
      await mainVotingPlugin.proposeAddMember(
        toUtf8Bytes('ipfs://'),
        ADDRESS_THREE
      );
      expect(await mainVotingPlugin.isMember(ADDRESS_THREE)).to.be.true;
    });
  });

  context('Leaving a space', () => {
    it('Completely removes an editor', async () => {
      await makeEditor(bob.address);

      // Bob leaves
      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.true;
      expect(await mainVotingPlugin.isMember(bob.address)).to.be.true;

      await expect(mainVotingPlugin.connect(bob).leaveSpace()).to.not.be
        .reverted;

      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.false;
      expect(await mainVotingPlugin.isMember(bob.address)).to.be.false;

      // Alice leaves
      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.true;
      expect(await mainVotingPlugin.isMember(alice.address)).to.be.true;

      await expect(mainVotingPlugin.leaveSpace()).to.not.be.reverted;

      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.false;
      expect(await mainVotingPlugin.isMember(alice.address)).to.be.false;
    });

    it('Allows a member to leave', async () => {
      await mainVotingPlugin.proposeAddMember(
        toUtf8Bytes('ipfs://'),
        carol.address
      );

      // Bob leaves
      expect(await mainVotingPlugin.isMember(bob.address)).to.be.true;
      await expect(mainVotingPlugin.connect(bob).leaveSpace()).to.not.be
        .reverted;
      expect(await mainVotingPlugin.isMember(bob.address)).to.be.false;

      // Carol leaves
      expect(await mainVotingPlugin.isMember(carol.address)).to.be.true;
      await expect(mainVotingPlugin.connect(carol).leaveSpace()).to.not.be
        .reverted;
      expect(await mainVotingPlugin.isMember(carol.address)).to.be.false;
    });

    it('Allows an editor to give editorship away', async () => {
      await makeEditor(bob.address);

      // Bob leaves as admin
      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.true;
      await expect(mainVotingPlugin.connect(bob).leaveSpaceAsEditor()).to.not.be
        .reverted;
      expect(await mainVotingPlugin.isEditor(bob.address)).to.be.false;

      // Alice leaves as editor
      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.true;
      await expect(mainVotingPlugin.leaveSpaceAsEditor()).to.not.be.reverted;
      expect(await mainVotingPlugin.isEditor(alice.address)).to.be.false;
    });
  });

  // Helpers
  const createDummyProposal = (proposer = alice, approving = false) => {
    const actions: IDAO.ActionStruct[] = [
      {
        to: dao.address,
        value: 0,
        data: '0x',
      },
    ];

    return mainVotingPlugin
      .connect(proposer)
      .createProposal(
        toUtf8Bytes('ipfs://'),
        actions,
        0, // fail safe
        approving ? VoteOption.Yes : VoteOption.None,
        true // auto execute
      )
      .then(tx => tx.wait());
  };

  const proposeNewEditor = (_editor: string, proposer = alice) => {
    const actions: IDAO.ActionStruct[] = [
      {
        to: mainVotingPlugin.address,
        value: 0,
        data: mainVotingPluginInterface.encodeFunctionData('addEditor', [
          _editor,
        ]),
      },
    ];

    return mainVotingPlugin
      .connect(proposer)
      .createProposal(
        toUtf8Bytes('ipfs://'),
        actions,
        0, // fail safe
        VoteOption.Yes,
        true // auto execute
      )
      .then(tx => tx.wait());
  };

  const proposeRemoveEditor = (_editor: string, proposer = alice) => {
    const actions: IDAO.ActionStruct[] = [
      {
        to: mainVotingPlugin.address,
        value: 0,
        data: mainVotingPluginInterface.encodeFunctionData('removeEditor', [
          _editor,
        ]),
      },
    ];

    return mainVotingPlugin
      .connect(proposer)
      .createProposal(
        toUtf8Bytes('ipfs://'),
        actions,
        0, // fail safe
        VoteOption.Yes,
        true // auto execute
      )
      .then(tx => tx.wait());
  };

  function makeEditor(targetAddress: string) {
    return dao
      .grant(
        mainVotingPlugin.address,
        alice.address,
        UPDATE_ADDRESSES_PERMISSION_ID
      )
      .then(tx => tx.wait())
      .then(() => mainVotingPlugin.addEditor(targetAddress))
      .then(tx => tx.wait())
      .then(() =>
        dao.revoke(
          mainVotingPlugin.address,
          alice.address,
          UPDATE_ADDRESSES_PERMISSION_ID
        )
      );
  }

  function pullEditor(targetAddress: string) {
    return dao
      .grant(
        mainVotingPlugin.address,
        alice.address,
        UPDATE_ADDRESSES_PERMISSION_ID
      )
      .then(tx => tx.wait())
      .then(() => mainVotingPlugin.removeEditor(targetAddress))
      .then(tx => tx.wait())
      .then(() =>
        dao.revoke(
          mainVotingPlugin.address,
          alice.address,
          UPDATE_ADDRESSES_PERMISSION_ID
        )
      );
  }
});

// TESTS REPLIACTED FROM THE ORIGINAL ADDRESS LIST PLUGIN

describe('Tests replicated from the original AddressList plugin', async () => {
  let signers: SignerWithAddress[];
  let dao: DAO;
  let mainVotingPlugin: MainVotingPlugin;
  let memberAccessPlugin: MemberAccessPlugin;

  let votingSettings: VotingSettings;
  let id = 0;
  let startDate: number;
  let endDate: number;
  let dummyMetadata: string;
  let dummyActions: IDAO.ActionStruct[];
  const startOffset = 10;

  before(async () => {
    signers = (await ethers.getSigners()).slice(0, 10);
    dao = await deployTestDao(signers[0]);
  });

  beforeEach(async () => {
    mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
      new MainVotingPlugin__factory(signers[0])
    );
    memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
      new MemberAccessPlugin__factory(signers[0])
    );

    // The plugin can execute on the DAO
    await dao.grant(
      dao.address,
      mainVotingPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // MemberAccessPlugin can execute on the DAO
    await dao.grant(
      dao.address,
      memberAccessPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // The DAO can update the plugin addresses
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPDATE_ADDRESSES_PERMISSION_ID
    );
    // The DAO can update the plugin settings
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPDATE_VOTING_SETTINGS_PERMISSION_ID
    );
    // The DAO can upgrade the plugin
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPGRADE_PLUGIN_PERMISSION_ID
    );
    // The DAO is ROOT on itself
    await dao.grant(dao.address, dao.address, ROOT_PERMISSION_ID);
    // Signers[0] can make the DAO execute testing actions
    await dao.grant(dao.address, signers[0].address, EXECUTE_PERMISSION_ID);

    // Values
    id = 0;
    votingSettings = JSON.parse(JSON.stringify(defaultMainVotingSettings));
    dummyMetadata = ethers.utils.hexlify(ethers.utils.toUtf8Bytes('ipfs://'));
    dummyActions = [
      {
        to: signers[0].address,
        data: '0x00000000',
        value: 0,
      },
    ];
  });

  describe('Proposal + Execute:', async () => {
    context('Standard Mode', async () => {
      beforeEach(async () => {
        votingSettings.votingMode = VotingMode.Standard;

        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers);
        await makeEditors(signers.slice(1)); // editors 2-10
        await mineBlock();

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration + startOffset;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('reverts on voting None', async () => {
        await advanceIntoVoteTime(startDate, endDate);
        const block = await ethers.provider.getBlockNumber();
        expect(await mainVotingPlugin.isEditor(signers[0].address)).to.eq(true);
        expect(await mainVotingPlugin.isListed(signers[0].address)).to.eq(true);
        expect(
          await mainVotingPlugin.isListedAtBlock(signers[0].address, block - 1)
        ).to.eq(true);

        // Check that voting is possible but don't vote using `callStatic`
        await expect(
          mainVotingPlugin.callStatic.vote(id, VoteOption.Yes, false)
        ).not.to.be.reverted;

        await expect(mainVotingPlugin.vote(id, VoteOption.None, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.None);
      });

      it('reverts on vote replacement', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await mainVotingPlugin.vote(id, VoteOption.Yes, false);

        // Try to replace the vote
        await expect(mainVotingPlugin.vote(id, VoteOption.Yes, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.Yes);
        await expect(mainVotingPlugin.vote(id, VoteOption.No, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.No);
        await expect(mainVotingPlugin.vote(id, VoteOption.Abstain, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.Abstain);
        await expect(mainVotingPlugin.vote(id, VoteOption.None, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.None);
      });

      it('cannot early execute', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4, 5], // 6 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('can execute normally if participation and support are met', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2], // 3 votes
          no: [3, 4], // 2 votes
          abstain: [5, 6], // 2 votes
        });

        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        const proposal = await mainVotingPlugin.getProposal(id);
        expect(proposal.open).to.be.false;
        expect(proposal.tally.yes.toNumber()).to.eq(3);
        expect(proposal.tally.no.toNumber()).to.eq(2);
        expect(proposal.tally.abstain.toNumber()).to.eq(2);
        expect(proposal.executed).to.be.false;

        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;

        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });

      it('does not execute early when voting with the `tryEarlyExecution` option', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4], // 5 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned on but the vote is not decided yet
        await mainVotingPlugin
          .connect(signers[5])
          .vote(id, VoteOption.Yes, true);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned off and the vote is decided
        await mainVotingPlugin
          .connect(signers[6])
          .vote(id, VoteOption.Yes, false);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned on and the vote is decided
        await mainVotingPlugin
          .connect(signers[7])
          .vote(id, VoteOption.Yes, true);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('reverts if vote is not decided yet', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });
    });

    context('Early Execution Mode', async () => {
      beforeEach(async () => {
        votingSettings.votingMode = VotingMode.EarlyExecution;

        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers);
        await makeEditors(signers.slice(1)); // editors 2-10

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('increases the yes, no, and abstain count and emits correct events', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await expect(
          mainVotingPlugin.connect(signers[0]).vote(id, VoteOption.Yes, false)
        )
          .to.emit(mainVotingPlugin, 'VoteCast')
          .withArgs(id, signers[0].address, VoteOption.Yes, 1);

        let proposal = await mainVotingPlugin.getProposal(id);
        expect(proposal.tally.yes).to.equal(1);
        expect(proposal.tally.no).to.equal(0);
        expect(proposal.tally.abstain).to.equal(0);

        await expect(
          mainVotingPlugin.connect(signers[1]).vote(id, VoteOption.No, false)
        )
          .to.emit(mainVotingPlugin, 'VoteCast')
          .withArgs(id, signers[1].address, VoteOption.No, 1);

        proposal = await mainVotingPlugin.getProposal(id);
        expect(proposal.tally.yes).to.equal(1);
        expect(proposal.tally.no).to.equal(1);
        expect(proposal.tally.abstain).to.equal(0);

        await expect(
          mainVotingPlugin
            .connect(signers[2])
            .vote(id, VoteOption.Abstain, false)
        )
          .to.emit(mainVotingPlugin, 'VoteCast')
          .withArgs(id, signers[2].address, VoteOption.Abstain, 1);

        proposal = await mainVotingPlugin.getProposal(id);
        expect(proposal.tally.yes).to.equal(1);
        expect(proposal.tally.no).to.equal(1);
        expect(proposal.tally.abstain).to.equal(1);
      });

      it('reverts on voting None', async () => {
        await advanceIntoVoteTime(startDate, endDate);
        const block = await ethers.provider.getBlockNumber();
        expect(await mainVotingPlugin.isEditor(signers[0].address)).to.eq(true);
        expect(await mainVotingPlugin.isListed(signers[0].address)).to.eq(true);
        expect(
          await mainVotingPlugin.isListedAtBlock(signers[0].address, block - 1)
        ).to.eq(true);

        // Check that voting is possible but don't vote using `callStatic`
        await expect(
          mainVotingPlugin.callStatic.vote(id, VoteOption.Yes, false)
        ).not.to.be.reverted;

        await expect(mainVotingPlugin.vote(id, VoteOption.None, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.None);
      });

      it('reverts on vote replacement', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await mainVotingPlugin.vote(id, VoteOption.Yes, false);

        // Try to replace the vote
        await expect(mainVotingPlugin.vote(id, VoteOption.Yes, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.Yes);
        await expect(mainVotingPlugin.vote(id, VoteOption.No, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.No);
        await expect(mainVotingPlugin.vote(id, VoteOption.Abstain, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.Abstain);
        await expect(mainVotingPlugin.vote(id, VoteOption.None, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.None);
      });

      it('can execute early if participation is large enough', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4, 5], // 6 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });

      it('can execute normally if participation and support are met', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2], // 3 votes
          no: [3, 4], // 2 votes
          abstain: [5, 6], // 2 votes
        });

        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;

        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        const proposal = await mainVotingPlugin.getProposal(id);
        expect(proposal.open).to.be.false;
        expect(proposal.tally.yes.toNumber()).to.eq(3);
        expect(proposal.tally.no.toNumber()).to.eq(2);
        expect(proposal.tally.abstain.toNumber()).to.eq(2);
        expect(proposal.executed).to.be.false;

        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;

        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });

      it('executes the vote immediately when the vote is decided early and the `tryEarlyExecution` option is selected', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3], // 4 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        // `tryEarlyExecution` is turned on but the vote is not decided yet
        await mainVotingPlugin
          .connect(signers[4])
          .vote(id, VoteOption.Yes, true);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned off and the vote is decided
        await mainVotingPlugin
          .connect(signers[5])
          .vote(id, VoteOption.Yes, false);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;

        // `tryEarlyExecution` is turned on and the vote is decided
        const tx = await mainVotingPlugin
          .connect(signers[6])
          .vote(id, VoteOption.Abstain, true);
        {
          const event = await findEventTopicLog<ExecutedEvent>(
            tx,
            DAO__factory.createInterface(),
            'Executed'
          );

          expect(event.args.actor).to.equal(mainVotingPlugin.address);
          expect(event.args.callId).to.equal(toBytes32(id));
          expect(event.args.actions.length).to.equal(1);
          expect(event.args.actions[0].to).to.equal(dummyActions[0].to);
          expect(event.args.actions[0].value).to.equal(dummyActions[0].value);
          expect(event.args.actions[0].data).to.equal(dummyActions[0].data);
          expect(event.args.execResults).to.deep.equal(['0x']);

          expect((await mainVotingPlugin.getProposal(id)).executed).to.be.true;
        }

        // check for the `ProposalExecuted` event in the voting contract
        {
          const event = await findEvent<ProposalExecutedEvent>(
            tx,
            'ProposalExecuted'
          );
          expect(event!.args.proposalId).to.equal(id);
        }

        // calling execute again should fail
        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });

      it('reverts if vote is not decided yet', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });
    });

    context('Vote Replacement Mode', async () => {
      beforeEach(async () => {
        votingSettings.votingMode = VotingMode.VoteReplacement;

        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers);
        await makeEditors(signers.slice(1)); // editors 2-10

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('reverts on voting None', async () => {
        await advanceIntoVoteTime(startDate, endDate);
        const block = await ethers.provider.getBlockNumber();
        expect(await mainVotingPlugin.isEditor(signers[0].address)).to.eq(true);
        expect(await mainVotingPlugin.isListed(signers[0].address)).to.eq(true);
        expect(
          await mainVotingPlugin.isListedAtBlock(signers[0].address, block - 1)
        ).to.eq(true);

        // Check that voting is possible but don't vote using `callStatic`
        await expect(
          mainVotingPlugin.callStatic.vote(id, VoteOption.Yes, false)
        ).not.to.be.reverted;

        await expect(mainVotingPlugin.vote(id, VoteOption.None, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.None);
      });

      it('should allow vote replacement but not double-count votes by the same address', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await mainVotingPlugin.vote(id, VoteOption.Yes, false);
        await mainVotingPlugin.vote(id, VoteOption.Yes, false);
        expect((await mainVotingPlugin.getProposal(id)).tally.yes).to.equal(1);
        expect((await mainVotingPlugin.getProposal(id)).tally.no).to.equal(0);
        expect((await mainVotingPlugin.getProposal(id)).tally.abstain).to.equal(
          0
        );

        await mainVotingPlugin.vote(id, VoteOption.No, false);
        await mainVotingPlugin.vote(id, VoteOption.No, false);
        expect((await mainVotingPlugin.getProposal(id)).tally.yes).to.equal(0);
        expect((await mainVotingPlugin.getProposal(id)).tally.no).to.equal(1);
        expect((await mainVotingPlugin.getProposal(id)).tally.abstain).to.equal(
          0
        );

        await mainVotingPlugin.vote(id, VoteOption.Abstain, false);
        await mainVotingPlugin.vote(id, VoteOption.Abstain, false);
        expect((await mainVotingPlugin.getProposal(id)).tally.yes).to.equal(0);
        expect((await mainVotingPlugin.getProposal(id)).tally.no).to.equal(0);
        expect((await mainVotingPlugin.getProposal(id)).tally.abstain).to.equal(
          1
        );

        await expect(mainVotingPlugin.vote(id, VoteOption.None, false))
          .to.be.revertedWithCustomError(mainVotingPlugin, 'VoteCastForbidden')
          .withArgs(id, signers[0].address, VoteOption.None);
      });

      it('cannot early execute', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4, 5], // 6 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('can execute normally if participation and support are met', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2], // 3 votes
          no: [3, 4], // 2 votes
          abstain: [5, 6], // 2 votes
        });

        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        const proposal = await mainVotingPlugin.getProposal(id);
        expect(proposal.open).to.be.false;
        expect(proposal.tally.yes.toNumber()).to.eq(3);
        expect(proposal.tally.no.toNumber()).to.eq(2);
        expect(proposal.tally.abstain.toNumber()).to.eq(2);
        expect(proposal.executed).to.be.false;

        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;

        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });

      it('does not execute early when voting with the `tryEarlyExecution` option', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4], // 5 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned on but the vote is not decided yet
        await mainVotingPlugin
          .connect(signers[4])
          .vote(id, VoteOption.Yes, true);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned off and the vote is decided
        await mainVotingPlugin
          .connect(signers[5])
          .vote(id, VoteOption.Yes, false);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // `tryEarlyExecution` is turned on and the vote is decided
        await mainVotingPlugin
          .connect(signers[5])
          .vote(id, VoteOption.Yes, true);
        expect((await mainVotingPlugin.getProposal(id)).executed).to.be.false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('reverts if vote is not decided yet', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });
    });
  });

  describe('Different configurations:', async () => {
    describe('A simple majority vote with >50% support and early execution', async () => {
      beforeEach(async () => {
        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers);
        await makeEditors(signers.slice(1)); // editors 2-10

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('does not execute if support is high but only the creator voted', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await mainVotingPlugin
          .connect(signers[0])
          .vote(id, VoteOption.Yes, false);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('does not execute if a non-creator voted but support is too low', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0], // 1 votes
          no: [1, 2], // 2 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('executes after the duration if a non-creator voted and support is met', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2], // 3 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true; // all criteria are met
      });

      it('executes early if participation and support are met and the vote outcome cannot change anymore', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4], // 4 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        await mainVotingPlugin
          .connect(signers[5])
          .vote(id, VoteOption.Yes, false);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [],
          no: [6, 7, 8, 9], // 4 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });
    });

    describe('An edge case with `supportThreshold = 0` in early execution mode activated', async () => {
      beforeEach(async () => {
        votingSettings.supportThreshold = pctToRatio(0);

        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers);
        await makeEditors(signers.slice(1)); // editors 2-10

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('does not execute with 0 votes', async () => {
        // does not execute early
        await advanceIntoVoteTime(startDate, endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // does not execute normally
        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
      });

      it('executes if a non-creator voted and support is met', async () => {
        // Check if the proposal can execute early
        await advanceIntoVoteTime(startDate, endDate);

        await mainVotingPlugin
          .connect(signers[1])
          .vote(id, VoteOption.Yes, false);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;

        // Check if the proposal can execute normally
        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });
    });

    describe('An edge case with `supportThreshold = 99.9999%` in early execution mode', async () => {
      beforeEach(async () => {
        votingSettings.supportThreshold = pctToRatio(100).sub(1);

        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers);
        await makeEditors(signers.slice(1)); // editors 2-10

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('does not early execute with 9 Yes votes', async () => {
        // does not execute early
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4, 5, 6, 7, 8], // 9 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;

        // does execute normally, after
        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });

      it('executes if a non-creator voted and support is met', async () => {
        // Check if the proposal can execute early
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], // 10 votes
          no: [], // 0 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;

        // Check if the proposal can execute normally
        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });
    });

    describe('Support threshold of 50%', () => {
      beforeEach(async () => {
        votingSettings.supportThreshold = pctToRatio(50);

        await mainVotingPlugin.initialize(
          dao.address,
          votingSettings,
          [signers[0].address],
          memberAccessPlugin.address
        );
        await memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        });
        await makeMembers(signers); // 10 members
        await makeEditors(signers.slice(0, 5)); // editors 0-5

        startDate = (await getTime()) + startOffset;
        endDate = startDate + votingSettings.duration;

        await mainVotingPlugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          VoteOption.None,
          false
        );
      });

      it('does not execute if support is high enough but only the proposer voted', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        expect(await mainVotingPlugin.addresslistLength()).to.eq(5);

        // 1
        await mainVotingPlugin
          .connect(signers[0])
          .vote(id, VoteOption.Yes, false);

        const prop = await mainVotingPlugin.getProposal(id);
        expect(prop.tally.yes).to.eq(1);
        expect(prop.tally.no).to.eq(0);
        expect(prop.tally.abstain).to.eq(0);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });

      it('does not execute if participation is high enough but support is too low', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        expect(await mainVotingPlugin.addresslistLength()).to.eq(5);
        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be
          .false;

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0], // 1 votes
          no: [1, 2, 3, 4], // 4 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be
          .false;
        expect(await mainVotingPlugin.canExecute(id)).to.be.false;
        await expect(mainVotingPlugin.execute(id))
          .to.be.revertedWithCustomError(
            mainVotingPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });

      it('executes after the duration if participation and support thresholds are met', async () => {
        await advanceIntoVoteTime(startDate, endDate);

        await voteWithSigners(mainVotingPlugin, id, signers, {
          yes: [0, 1, 2], // 3 votes
          no: [3, 4], // 2 votes
          abstain: [], // 0 votes
        });

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReachedEarly(id)).to.be
          .true;

        expect(await mainVotingPlugin.canExecute(id)).to.be.true;

        await advanceAfterVoteEnd(endDate);

        expect(await mainVotingPlugin.isMinParticipationReached(id)).to.be.true;
        expect(await mainVotingPlugin.isSupportThresholdReached(id)).to.be.true;
        expect(await mainVotingPlugin.canExecute(id)).to.be.true;
      });
    });
  });

  // Helpers

  function voteWithSigners(
    votingContract: MainVotingPlugin,
    proposalId: number,
    signers: SignerWithAddress[],
    signerIds: {
      yes: number[];
      no: number[];
      abstain: number[];
    }
  ) {
    let promises = signerIds.yes.map(i =>
      votingContract.connect(signers[i]).vote(proposalId, VoteOption.Yes, false)
    );

    promises = promises.concat(
      signerIds.no.map(i =>
        votingContract
          .connect(signers[i])
          .vote(proposalId, VoteOption.No, false)
      )
    );
    promises = promises.concat(
      signerIds.abstain.map(i =>
        votingContract
          .connect(signers[i])
          .vote(proposalId, VoteOption.Abstain, false)
      )
    );

    return Promise.all(promises);
  }

  function makeMembers(targetAddresses: SignerWithAddress[]) {
    return dao
      .grant(
        mainVotingPlugin.address,
        signers[0].address,
        UPDATE_ADDRESSES_PERMISSION_ID
      )
      .then(tx => tx.wait())
      .then(() =>
        Promise.all(
          targetAddresses.map(targetAddress =>
            mainVotingPlugin
              .addMember(targetAddress.address)
              .then(tx => tx.wait())
              .then(() => mainVotingPlugin.isMember(targetAddress.address))
              .then(isMember => expect(isMember).to.eq(true))
          )
        )
      )
      .then(() =>
        dao.revoke(
          mainVotingPlugin.address,
          signers[0].address,
          UPDATE_ADDRESSES_PERMISSION_ID
        )
      )
      .then(tx => tx.wait());
  }

  function makeEditors(targetAddresses: SignerWithAddress[]) {
    return dao
      .grant(
        mainVotingPlugin.address,
        signers[0].address,
        UPDATE_ADDRESSES_PERMISSION_ID
      )
      .then(tx => tx.wait())
      .then(() =>
        Promise.all(
          targetAddresses.map(targetAddress =>
            mainVotingPlugin
              .addEditor(targetAddress.address)
              .then(tx => tx.wait())
              .then(() => mainVotingPlugin.isMember(targetAddress.address))
              .then(isMember => expect(isMember).to.eq(true))
              .then(() => mainVotingPlugin.isEditor(targetAddress.address))
              .then(isEditor => expect(isEditor).to.eq(true))
          )
        )
      )
      .then(() =>
        dao.revoke(
          mainVotingPlugin.address,
          signers[0].address,
          UPDATE_ADDRESSES_PERMISSION_ID
        )
      );
  }
});

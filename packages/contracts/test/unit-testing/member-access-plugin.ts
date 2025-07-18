import {
  DAO,
  IDAO,
  IERC165Upgradeable__factory,
  IMultisig__factory,
  IPlugin__factory,
  IProposal__factory,
  MainVotingPlugin,
  MainVotingPlugin__factory,
  MemberAccessPlugin,
  MemberAccessPlugin__factory,
  MemberAccessExecuteCondition,
  MemberAccessExecuteCondition__factory,
  SpacePlugin,
  SpacePlugin__factory,
} from '../../typechain';
import {
  ApprovedEvent,
  ProposalCreatedEvent,
} from '../../typechain/src/governance/MemberAccessPlugin';
import {deployWithProxy, findEvent} from '../../utils/helpers';
import {getInterfaceID} from '../../utils/interfaces';
import {deployTestDao} from '../helpers/test-dao';
import {
  ADDRESS_ONE,
  ADDRESS_TWO,
  ADDRESS_ZERO,
  EMPTY_DATA,
  EXECUTE_PERMISSION_ID,
  mineBlock,
  PROPOSER_PERMISSION_ID,
  ROOT_PERMISSION_ID,
  UPDATE_ADDRESSES_PERMISSION_ID,
  UPDATE_MULTISIG_SETTINGS_PERMISSION_ID,
  UPGRADE_PLUGIN_PERMISSION_ID,
  VoteOption,
  ZERO_BYTES32,
} from './common';
import {defaultMainVotingSettings} from './common';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {hexlify, toUtf8Bytes} from 'ethers/lib/utils';
import {ethers} from 'hardhat';

export type InitData = {contentUri: string; metadata: string};
export const defaultInitData: InitData = {
  contentUri: 'ipfs://',
  metadata: '0x',
};

export const multisigInterface = new ethers.utils.Interface([
  'function initialize(address,tuple(uint64))',
  'function updateMultisigSettings(tuple(uint64))',
  'function proposeAddMember(bytes,address,address)',
  'function getProposal(uint256)',
]);
const mainVotingPluginInterface = MainVotingPlugin__factory.createInterface();

describe('Member Access Plugin', function () {
  let signers: SignerWithAddress[];
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dave: SignerWithAddress;
  let dao: DAO;
  let memberAccessPlugin: MemberAccessPlugin;
  let memberAccessExecuteCondition: MemberAccessExecuteCondition;
  let mainVotingPlugin: MainVotingPlugin;
  let spacePlugin: SpacePlugin;
  let defaultInput: InitData;
  let pid: BigNumber;

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

    memberAccessExecuteCondition =
      await new MemberAccessExecuteCondition__factory(alice).deploy(
        mainVotingPlugin.address
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
    await dao.grantWithCondition(
      dao.address,
      memberAccessPlugin.address,
      EXECUTE_PERMISSION_ID,
      memberAccessExecuteCondition.address
    );
    // The main voting plugin can also execute on the DAO
    await dao.grant(
      dao.address,
      mainVotingPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // The DAO can report new/removed editors to the main voting plugin
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPDATE_ADDRESSES_PERMISSION_ID
    );
    // The DAO can update the plugin settings
    await dao.grant(
      memberAccessPlugin.address,
      dao.address,
      UPDATE_MULTISIG_SETTINGS_PERMISSION_ID
    );
    // The DAO can upgrade the plugin
    await dao.grant(
      memberAccessPlugin.address,
      dao.address,
      UPGRADE_PLUGIN_PERMISSION_ID
    );
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

    // Alice is an editor (see mainVotingPlugin initialize)

    // Bob is a member
    await mineBlock();
    await mainVotingPlugin.proposeAddMember('0x', bob.address);
  });

  describe('initialize', () => {
    it('reverts if trying to re-initialize', async () => {
      await expect(
        memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
        })
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
  });

  describe('Before approving', () => {
    it('Only addresses with PROPOSER_PERMISSION_ID can propose members', async () => {
      // ok
      await expect(
        mainVotingPlugin.proposeAddMember(toUtf8Bytes('ipfs://'), carol.address)
      ).to.not.be.reverted;

      await dao.revoke(
        memberAccessPlugin.address,
        mainVotingPlugin.address,
        PROPOSER_PERMISSION_ID
      );

      // Now it fails
      await expect(
        mainVotingPlugin.proposeAddMember(toUtf8Bytes('ipfs://'), dave.address)
      ).to.be.reverted;
    });

    it('Only callers implementing multisig can propose members', async () => {
      // From a compatible plugin
      await expect(
        mainVotingPlugin.proposeAddMember(toUtf8Bytes('ipfs://'), carol.address)
      ).to.not.be.reverted;

      await dao.grant(
        memberAccessPlugin.address,
        alice.address,
        PROPOSER_PERMISSION_ID
      );

      // Fail despite the permission
      await expect(
        memberAccessPlugin.proposeAddMember(
          toUtf8Bytes('ipfs://'),
          dave.address,
          alice.address
        )
      ).to.be.reverted;
    });

    it('Allows any address to request membership via the MainVoting plugin', async () => {
      // Random
      expect(await mainVotingPlugin.isMember(carol.address)).to.be.false;
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      let proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.approvals).to.eq(0);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.failsafeActionMap).to.eq(0);
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Member
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(bob)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.approvals).to.eq(0);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.failsafeActionMap).to.eq(0);
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Editor
      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;

      proposal = await memberAccessPlugin.getProposal(1);
      expect(proposal.executed).to.eq(false);
      expect(proposal.approvals).to.eq(0);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.failsafeActionMap).to.eq(0);
      // Auto executed
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(true);
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(true);
    });

    it('Editors should be members too', async () => {
      expect(await mainVotingPlugin.isMember(alice.address)).to.eq(true);
      expect(await mainVotingPlugin.isMember(alice.address)).to.eq(true);
    });

    it('Emits an event when membership is requested', async () => {
      pid = await memberAccessPlugin.proposalCount();

      const tx = await mainVotingPlugin
        .connect(carol)
        .proposeAddMember(toUtf8Bytes('ipfs://2345'), carol.address);

      await expect(tx).to.emit(memberAccessPlugin, 'ProposalCreated');

      const event = await findEvent<ProposalCreatedEvent>(
        tx,
        'ProposalCreated'
      );

      expect(!!event).to.eq(true);
      expect(event!.args.proposalId).to.equal(pid);
      expect(event!.args.creator).to.equal(carol.address);
      expect(event!.args.metadata).to.equal(
        hexlify(toUtf8Bytes('ipfs://2345'))
      );
      expect(event!.args.actions.length).to.equal(1);
      expect(event!.args.actions[0].to).to.equal(mainVotingPlugin.address);
      expect(event!.args.actions[0].value).to.equal(0);
      expect(event!.args.actions[0].data).to.equal(
        mainVotingPluginInterface.encodeFunctionData('addMember', [
          carol.address,
        ])
      );
      expect(event!.args.allowFailureMap).to.equal(0);
    });

    it('isMember() returns true when appropriate', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

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

      await proposeNewEditor(carol.address);

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(true);
    });

    it('isEditor() returns true when appropriate', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      expect(await mainVotingPlugin.isEditor(ADDRESS_ZERO)).to.eq(false);
      expect(await mainVotingPlugin.isEditor(ADDRESS_ONE)).to.eq(false);
      expect(await mainVotingPlugin.isEditor(ADDRESS_TWO)).to.eq(false);

      expect(await mainVotingPlugin.isEditor(alice.address)).to.eq(true);
      expect(await mainVotingPlugin.isEditor(bob.address)).to.eq(false);
      expect(await mainVotingPlugin.isEditor(carol.address)).to.eq(false);

      await proposeNewEditor(carol.address);

      expect(await mainVotingPlugin.isEditor(carol.address)).to.eq(true);
    });
  });

  describe('One editor case', () => {
    it('Only the editor can approve memberships', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Approve it (Bob) => fail
      await expect(memberAccessPlugin.connect(bob).approve(pid)).to.be.reverted;

      // Still not a member
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Approve it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.not.be
        .reverted;

      // Now Carol is a member
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(true);
    });

    it('Only the editor can reject memberships', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Reject it (Bob) => fail
      await expect(memberAccessPlugin.connect(bob).reject(pid)).to.be.reverted;

      // Still not a member
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Reject it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).reject(pid)).to.not.be
        .reverted;

      // Carol is not a member
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Try to approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.be
        .reverted;
    });

    it('Membership approvals are immediate', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      // Approve it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.not.be
        .reverted;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(true);

      // Approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.be
        .reverted;
    });

    it('Membership rejections are immediate', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      // Reject it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).reject(pid)).to.not.be
        .reverted;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);

      // Try to approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(bob).reject(pid)).to.be.reverted;
    });

    it('Proposal execution is immediate when created by the only editor', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Alice proposes
      await expect(
        mainVotingPlugin.proposeAddMember(
          toUtf8Bytes('ipfs://1234'),
          carol.address
        )
      ).to.not.be.reverted;

      // Now Carol is a member
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(true);
    });

    it("Proposals created by a non-editor need an editor's approval", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Dave cannot
      await expect(memberAccessPlugin.connect(dave).approve(pid)).to.be
        .reverted;
      await expect(memberAccessPlugin.connect(dave).execute(pid)).to.be
        .reverted;
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Alice can
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(true);
    });
  });

  describe('Multiple editors case', () => {
    // Alice: editor
    // Bob: editor
    // Carol: editor

    beforeEach(async () => {
      let pidMainVoting = 0;
      await proposeNewEditor(bob.address);
      await proposeNewEditor(carol.address);
      pidMainVoting = 1;
      await mainVotingPlugin
        .connect(bob)
        .vote(pidMainVoting, VoteOption.Yes, true);
    });

    it('Only editors can approve adding members', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Requesting membership for Dave
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid)).to.be
        .reverted;

      // Dave is still not a member
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Approve it (Alice)
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.not.be
        .reverted;

      // Dave is now a member
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(true);

      // Now requesting for 0x1
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid)).to.be
        .reverted;

      // ADDRESS_ONE is still not a member
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Approve it (Bob)
      await expect(memberAccessPlugin.connect(bob).approve(pid)).to.not.be
        .reverted;

      // ADDRESS_ONE is now a member
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(true);

      // Now requesting for 0x2
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(false);
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(false);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid)).to.be
        .reverted;

      // ADDRESS_TWO is still not a member
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(false);

      // Approve it (Carol)
      await expect(memberAccessPlugin.connect(carol).approve(pid)).to.not.be
        .reverted;

      // ADDRESS_TWO is now a member
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(true);
    });

    it('Proposals should be unsettled after created', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Proposed by a random wallet
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      let proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      await mainVotingPlugin.proposeAddMember('0x', dave.address);

      // Proposed by a (now) member
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Proposed by an editor
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(2);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(false);
    });

    it('Only editors can reject new membership proposals', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Reject it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).reject(pid)).to.be.reverted;

      // Still not a member
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Reject it (Bob) => success
      await expect(memberAccessPlugin.connect(bob).reject(pid)).to.not.be
        .reverted;

      // Still not a member
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Try to approve it (bob) => fail
      await expect(memberAccessPlugin.connect(bob).approve(pid)).to.be.reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);
    });

    it("Proposals created by a non-editor need an editor's approval", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Dave cannot
      await expect(memberAccessPlugin.connect(dave).approve(pid)).to.be
        .reverted;
      await expect(memberAccessPlugin.connect(dave).execute(pid)).to.be
        .reverted;
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);

      // Alice can
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.not.be
        .reverted;
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(true);
    });

    it("Proposals created by an editor need another editor's approval", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(2);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
    });

    it('Memberships are approved when the first non-proposer editor approves', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Alice proposes a mew member
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      let proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);

      // Approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(pid)).to.be
        .reverted;

      // Approve it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).approve(pid)).to.be
        .reverted;

      // Approve it (Bob) => succeed
      await expect(memberAccessPlugin.connect(bob).approve(pid)).to.not.be
        .reverted;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(true);

      // Now Dave is a member
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(true);
    });

    it('Memberships are rejected when the first non-proposer editor rejects', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Alice proposes a mew member
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Reject it (Alice) => can't change
      await expect(memberAccessPlugin.connect(alice).reject(pid)).to.be
        .reverted;

      // Reject it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).reject(pid)).to.be.reverted;

      // Reject it (Bob) => succeed
      await expect(memberAccessPlugin.connect(bob).reject(pid)).to.not.be
        .reverted;

      // Reject it (Carol) => can't anymore
      await expect(memberAccessPlugin.connect(carol).reject(pid)).to.be
        .reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Dave is still not a member
      expect(await mainVotingPlugin.isMember(dave.address)).to.eq(false);
    });
  });

  describe('Approving', () => {
    // Alice: editor
    // Bob: member

    it('proposeNewMember should generate the right action list', async () => {
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(mainVotingPlugin.address);
      expect(proposal.actions[0].value).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        mainVotingPluginInterface.encodeFunctionData('addMember', [
          carol.address,
        ])
      );
    });

    it('Proposing an existing member fails', async () => {
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), alice.address)
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'AlreadyAMember')
        .withArgs(alice.address);

      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), bob.address)
      )
        .to.be.revertedWithCustomError(mainVotingPlugin, 'AlreadyAMember')
        .withArgs(bob.address);
    });

    it('Attempting to approve twice fails', async () => {
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      await expect(memberAccessPlugin.approve(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.approve(pid)).to.be.reverted;
    });

    it('Attempting to reject twice fails', async () => {
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      await expect(memberAccessPlugin.reject(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.reject(pid)).to.be.reverted;
    });

    it('Attempting to propose adding an existing member fails', async () => {
      await expect(
        mainVotingPlugin
          .connect(carol)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), alice.address)
      ).to.be.reverted;

      await expect(
        mainVotingPlugin
          .connect(bob)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), alice.address)
      ).to.be.reverted;

      await expect(
        mainVotingPlugin
          .connect(alice)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), alice.address)
      ).to.be.reverted;
    });

    it('Rejected proposals cannot be approved', async () => {
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      await expect(memberAccessPlugin.reject(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.approve(pid)).to.be.reverted;
    });

    it('Rejected proposals cannot be executed', async () => {
      pid = await memberAccessPlugin.proposalCount();
      await expect(
        mainVotingPlugin
          .connect(dave)
          .proposeAddMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      await expect(memberAccessPlugin.reject(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.execute(pid)).to.be.reverted;
    });

    it('Only the DAO can call the plugin to update the settings', async () => {
      // Nobody else can
      await expect(
        memberAccessPlugin.connect(alice).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
        })
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(bob).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
        })
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(carol).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
        })
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(dave).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
        })
      ).to.be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: memberAccessPlugin.address,
          value: 0,
          data: MemberAccessPlugin__factory.createInterface().encodeFunctionData(
            'updateMultisigSettings',
            [
              {
                proposalDuration: 60 * 60 * 24 * 5,
              },
            ]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });

    it('The DAO can upgrade the plugin', async () => {
      // Nobody else can
      await expect(memberAccessPlugin.connect(alice).upgradeTo(ADDRESS_ONE)).to
        .be.reverted;
      await expect(memberAccessPlugin.connect(bob).upgradeTo(ADDRESS_ONE)).to.be
        .reverted;
      await expect(
        memberAccessPlugin.connect(carol).upgradeToAndCall(
          memberAccessPlugin.implementation(), // upgrade to itself
          EMPTY_DATA
        )
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(dave).upgradeToAndCall(
          memberAccessPlugin.implementation(), // upgrade to itself
          EMPTY_DATA
        )
      ).to.be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: memberAccessPlugin.address,
          value: 0,
          data: MemberAccessPlugin__factory.createInterface().encodeFunctionData(
            'upgradeTo',
            [await memberAccessPlugin.implementation()]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });
  });

  describe('Tests replicated from MultisigPlugin', () => {
    describe('initialize', () => {
      it('reverts if trying to re-initialize', async () => {
        await expect(
          memberAccessPlugin.initialize(dao.address, {
            proposalDuration: 60 * 60 * 24 * 5,
          })
        ).to.be.revertedWith('Initializable: contract is already initialized');
        await expect(
          mainVotingPlugin.initialize(
            dao.address,
            defaultMainVotingSettings,
            [alice.address],
            memberAccessPlugin.address
          )
        ).to.be.revertedWith('Initializable: contract is already initialized');
        await expect(
          spacePlugin.initialize(
            dao.address,
            defaultInput.contentUri,
            defaultInput.metadata,
            ADDRESS_ZERO
          )
        ).to.be.revertedWith('Initializable: contract is already initialized');
      });

      it('should emit `MultisigSettingsUpdated` during initialization', async () => {
        memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
          new MemberAccessPlugin__factory(alice)
        );
        const multisigSettings: MemberAccessPlugin.MultisigSettingsStruct = {
          proposalDuration: 60 * 60 * 24 * 5,
        };

        await expect(
          memberAccessPlugin.initialize(dao.address, multisigSettings)
        )
          .to.emit(memberAccessPlugin, 'MultisigSettingsUpdated')
          .withArgs(60 * 60 * 24 * 5);
      });
    });

    describe('plugin interface: ', () => {
      it('does not support the empty interface', async () => {
        expect(await memberAccessPlugin.supportsInterface('0xffffffff')).to.be
          .false;
      });

      it('supports the `IERC165Upgradeable` interface', async () => {
        const iface = IERC165Upgradeable__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `IPlugin` interface', async () => {
        const iface = IPlugin__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `IProposal` interface', async () => {
        const iface = IProposal__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `IMultisig` interface', async () => {
        const iface = IMultisig__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `Multisig` interface', async () => {
        expect(
          await memberAccessPlugin.supportsInterface(
            getInterfaceID(multisigInterface)
          )
        ).to.be.true;
      });
    });

    describe('updateMultisigSettings:', () => {
      it('should emit `MultisigSettingsUpdated` when `updateMutlsigSettings` gets called', async () => {
        await dao.grant(
          memberAccessPlugin.address,
          alice.address,
          await memberAccessPlugin.UPDATE_MULTISIG_SETTINGS_PERMISSION_ID()
        );
        const multisigSettings = {
          proposalDuration: 60 * 60 * 24 * 5,
        };

        await expect(
          memberAccessPlugin.updateMultisigSettings(multisigSettings)
        )
          .to.emit(memberAccessPlugin, 'MultisigSettingsUpdated')
          .withArgs(60 * 60 * 24 * 5);
      });
    });

    describe('createProposal:', () => {
      it('increments the proposal counter', async () => {
        const pc = await memberAccessPlugin.proposalCount();

        await expect(
          mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address)
        ).not.to.be.reverted;

        expect(await memberAccessPlugin.proposalCount()).to.equal(pc.add(1));
      });

      it('creates unique proposal IDs for each proposal', async () => {
        const proposalId0 = await mainVotingPlugin.callStatic.proposeAddMember(
          EMPTY_DATA,
          carol.address
        );
        // create a new proposal for the proposalCounter to be incremented
        await expect(
          mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address)
        ).not.to.be.reverted;

        const proposalId1 = await mainVotingPlugin.callStatic.proposeAddMember(
          EMPTY_DATA,
          dave.address
        );

        expect(proposalId0).to.equal(1);
        expect(proposalId1).to.equal(2);

        expect(proposalId0).to.not.equal(proposalId1);
      });

      it('emits the `ProposalCreated` event', async () => {
        await expect(
          mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address)
        ).to.emit(memberAccessPlugin, 'ProposalCreated');
      });

      it('reverts if the multisig settings have been changed in the same block', async () => {
        await dao.grant(
          memberAccessPlugin.address,
          dao.address,
          await memberAccessPlugin.UPDATE_MULTISIG_SETTINGS_PERMISSION_ID()
        );

        await ethers.provider.send('evm_setAutomine', [false]);

        await dao.execute(
          ZERO_BYTES32,
          [
            {
              to: memberAccessPlugin.address,
              value: 0,
              data: memberAccessPlugin.interface.encodeFunctionData(
                'updateMultisigSettings',
                [
                  {
                    proposalDuration: 60 * 60 * 24 * 5,
                  },
                ]
              ),
            },
          ],
          0
        );
        await expect(
          mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address)
        ).to.revertedWithCustomError(
          memberAccessPlugin,
          'ProposalCreationForbiddenOnSameBlock'
        );

        await ethers.provider.send('evm_setAutomine', [true]);
      });
    });

    describe('canApprove:', () => {
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        expect(await mainVotingPlugin.isEditor(alice.address)).to.be.true;
        expect(await mainVotingPlugin.isEditor(bob.address)).to.be.true;
        expect(await mainVotingPlugin.isEditor(carol.address)).to.be.false;

        // Alice approves
        pid = await memberAccessPlugin.proposalCount();
        await mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address);
      });

      it('returns `false` if the proposal is already executed', async () => {
        expect((await memberAccessPlugin.getProposal(pid)).executed).to.be
          .false;
        await memberAccessPlugin.connect(bob).approve(pid);

        expect((await memberAccessPlugin.getProposal(pid)).executed).to.be.true;
        expect(await memberAccessPlugin.canApprove(pid, signers[3].address)).to
          .be.false;
      });

      it('returns `false` if the approver is not an editor', async () => {
        expect(await mainVotingPlugin.isEditor(signers[9].address)).to.be.false;

        expect(await memberAccessPlugin.canApprove(pid, signers[9].address)).to
          .be.false;
      });

      it('returns `false` if the approver has already approved', async () => {
        expect(await memberAccessPlugin.canApprove(pid, bob.address)).to.be
          .true;
        await memberAccessPlugin.connect(bob).approve(pid);
        expect(await memberAccessPlugin.canApprove(pid, bob.address)).to.be
          .false;
      });

      it('returns `true` if the approver is listed', async () => {
        expect(await memberAccessPlugin.canApprove(pid, bob.address)).to.be
          .true;
      });

      it('returns `false` if the proposal is settled', async () => {
        pid = await memberAccessPlugin.proposalCount();
        await mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address);

        expect(await memberAccessPlugin.canApprove(pid, bob.address)).to.be
          .true;

        await memberAccessPlugin.connect(bob).approve(pid);

        expect(await memberAccessPlugin.canApprove(pid, bob.address)).to.be
          .false;
      });
    });

    describe('hasApproved', () => {
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        // Carol is a member
        pid = await memberAccessPlugin.proposalCount();
        await mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address);
      });

      it("returns `false` if user hasn't approved yet", async () => {
        expect(await memberAccessPlugin.hasApproved(pid, bob.address)).to.be
          .false;
      });

      it('returns `true` if user has approved', async () => {
        await memberAccessPlugin.connect(bob).approve(pid);
        expect(await memberAccessPlugin.hasApproved(pid, bob.address)).to.be
          .true;
      });
    });

    describe('approve:', () => {
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        // Alice approves
        pid = await memberAccessPlugin.proposalCount();
        await mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address);
      });

      it('reverts when approving multiple times', async () => {
        await memberAccessPlugin.connect(bob).approve(pid);

        // Try to vote again
        await expect(memberAccessPlugin.connect(bob).approve(pid))
          .to.be.revertedWithCustomError(
            memberAccessPlugin,
            'ApprovalCastForbidden'
          )
          .withArgs(pid, bob.address);
      });

      it('reverts if minimal approval is not met yet', async () => {
        const proposal = await memberAccessPlugin.getProposal(pid);
        expect(proposal.approvals).to.eq(1);
        await expect(memberAccessPlugin.execute(pid))
          .to.be.revertedWithCustomError(
            memberAccessPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(pid);
      });

      it('approves with the msg.sender address', async () => {
        expect((await memberAccessPlugin.getProposal(pid)).approvals).to.equal(
          1
        );

        const tx = await memberAccessPlugin.connect(bob).approve(pid);

        const event = await findEvent<ApprovedEvent>(tx, 'Approved');
        expect(event!.args.proposalId).to.eq(pid);
        expect(event!.args.editor).to.eq(bob.address);

        expect((await memberAccessPlugin.getProposal(pid)).approvals).to.equal(
          2
        );
      });
    });

    describe('canExecute:', () => {
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        expect(await mainVotingPlugin.isEditor(alice.address)).to.be.true;
        expect(await mainVotingPlugin.isEditor(bob.address)).to.be.true;
        expect(await mainVotingPlugin.isEditor(carol.address)).to.be.false;

        // Alice approves
        pid = await memberAccessPlugin.proposalCount();
        await mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address);
      });

      it('returns `false` if the proposal has not reached the minimum approval yet', async () => {
        const proposal = await memberAccessPlugin.getProposal(pid);
        expect(proposal.approvals).to.be.lt(proposal.parameters.minApprovals);

        expect(await memberAccessPlugin.canExecute(pid)).to.be.false;
      });

      it('returns `false` if the proposal is already executed', async () => {
        expect((await memberAccessPlugin.getProposal(pid)).executed).to.be
          .false;
        expect(
          (await memberAccessPlugin.getProposal(pid)).actions.length
        ).to.eq(1);

        // Approve and execute
        await memberAccessPlugin.connect(bob).approve(pid);

        expect((await memberAccessPlugin.getProposal(pid)).executed).to.be.true;

        expect(await memberAccessPlugin.canExecute(pid)).to.be.false;
      });
    });

    describe('execute:', () => {
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        // Alice approves
        pid = await memberAccessPlugin.proposalCount();
        await mainVotingPlugin.proposeAddMember(EMPTY_DATA, carol.address);
      });

      it('reverts if the minimum approval is not met', async () => {
        await expect(memberAccessPlugin.execute(pid))
          .to.be.revertedWithCustomError(
            memberAccessPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(pid);
      });

      it('emits the `Approved`, `ProposalExecuted`, and `Executed` events if execute is called inside the `approve` method', async () => {
        await expect(memberAccessPlugin.connect(bob).approve(pid))
          .to.emit(dao, 'Executed')
          .to.emit(memberAccessPlugin, 'ProposalExecuted')
          .to.emit(memberAccessPlugin, 'Approved');
      });
    });
  });

  // Helpers

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
});

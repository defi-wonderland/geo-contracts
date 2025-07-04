import {
  DAO,
  IERC165Upgradeable__factory,
  PersonalSpaceAdminCloneFactory,
  PersonalSpaceAdminCloneFactory__factory,
  PersonalSpaceAdminPlugin,
  PersonalSpaceAdminPlugin__factory,
  SpacePlugin,
  SpacePlugin__factory,
} from '../../typechain';
import {ExecutedEvent} from '../../typechain/@aragon/osx/core/dao/IDAO';
import {ProposalCreatedEvent} from '../../typechain/src/personal/PersonalSpaceAdminPlugin';
import {
  deployWithProxy,
  findEvent,
  findEventTopicLog,
  toBytes32,
} from '../../utils/helpers';
import {getInterfaceID} from '../../utils/interfaces';
import {deployTestDao} from '../helpers/test-dao';
import {
  ADDRESS_ONE,
  ADDRESS_THREE,
  ADDRESS_TWO,
  ADDRESS_ZERO,
  CONTENT_PERMISSION_ID,
  MEMBER_PERMISSION_ID,
  EDITOR_PERMISSION_ID,
  EXECUTE_PERMISSION_ID,
  SUBSPACE_PERMISSION_ID,
  PAYER_PERMISSION_ID,
  ROOT_PERMISSION_ID,
} from './common';
import {
  DAO__factory,
  IPlugin__factory,
  IProposal__factory,
} from '@aragon/osx-ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {ethers} from 'hardhat';

export type InitData = {contentUri: string; metadata: string};
export const defaultInitData: InitData = {
  contentUri: 'ipfs://',
  metadata: '0x',
};
export const psvpInterface = new ethers.utils.Interface([
  'function initialize(address, address)',
  'function executeProposal(bytes,tuple(address,uint256,bytes)[],uint256)',
  'function submitEdits(string, bytes, address)',
  'function submitFlagContent(string, address)',
  'function submitAcceptSubspace(address _subspaceDao, address _spacePlugin)',
  'function submitRemoveSubspace(address _subspaceDao, address _spacePlugin)',
  'function submitNewEditor(address _newEditor)',
  'function submitNewMember(address _newMember)',
  'function submitRemoveEditor(address _editor)',
  'function submitRemoveMember(address _member)',
  'function submitSetPayer(address _payer, address _spacePlugin)',
  'function leaveSpace()',
]);

describe('Personal Space Admin Plugin', function () {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dao: DAO;
  let personalSpaceVotingPlugin: PersonalSpaceAdminPlugin;
  let personalSpaceVotingCloneFactory: PersonalSpaceAdminCloneFactory;
  let spacePlugin: SpacePlugin;
  let defaultInput: InitData;
  let dummyActions: any;
  let dummyMetadata: string;

  before(async () => {
    [alice, bob, carol] = await ethers.getSigners();
    dao = await deployTestDao(alice);

    defaultInput = {contentUri: 'ipfs://', metadata: '0x'};
    dummyActions = [
      {
        to: alice.address,
        data: '0x0000',
        value: 0,
      },
    ];
    dummyMetadata = ethers.utils.hexlify(
      ethers.utils.toUtf8Bytes('0x123456789')
    );

    const PersonalSpaceAdminCloneFactory =
      new PersonalSpaceAdminCloneFactory__factory(alice);
    personalSpaceVotingCloneFactory =
      await PersonalSpaceAdminCloneFactory.deploy();
  });

  beforeEach(async () => {
    // Space
    spacePlugin = await deployWithProxy<SpacePlugin>(
      new SpacePlugin__factory(alice)
    );
    await spacePlugin.initialize(
      dao.address,
      defaultInput.contentUri,
      defaultInput.metadata,
      ADDRESS_ZERO
    );

    // Personal Space Voting
    const PersonalSpaceVotingFactory = new PersonalSpaceAdminPlugin__factory(
      alice
    );
    const nonce = await ethers.provider.getTransactionCount(
      personalSpaceVotingCloneFactory.address
    );
    const anticipatedPluginAddress = ethers.utils.getContractAddress({
      from: personalSpaceVotingCloneFactory.address,
      nonce,
    });
    await personalSpaceVotingCloneFactory.deployClone();
    personalSpaceVotingPlugin = PersonalSpaceVotingFactory.attach(
      anticipatedPluginAddress
    );
    await initializePSVPlugin();

    // Alice is editor
    await dao.grant(
      personalSpaceVotingPlugin.address,
      alice.address,
      EDITOR_PERMISSION_ID
    );
    // Bob is a member
    await dao.grant(
      personalSpaceVotingPlugin.address,
      bob.address,
      MEMBER_PERMISSION_ID
    );
    // The plugin can execute on the DAO
    await dao.grant(
      dao.address,
      personalSpaceVotingPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // The DAO can use the Space
    await dao.grant(spacePlugin.address, dao.address, CONTENT_PERMISSION_ID);
    await dao.grant(spacePlugin.address, dao.address, SUBSPACE_PERMISSION_ID);
    await dao.grant(spacePlugin.address, dao.address, PAYER_PERMISSION_ID);
    // The DAO is root on itself
    await dao.grant(dao.address, dao.address, ROOT_PERMISSION_ID);
  });

  function initializePSVPlugin() {
    return personalSpaceVotingPlugin.initialize(dao.address, alice.address);
  }

  describe('initialize: ', async () => {
    it('reverts if trying to re-initialize', async () => {
      // recreate
      const PersonalSpaceVotingFactory = new PersonalSpaceAdminPlugin__factory(
        alice
      );
      const nonce = await ethers.provider.getTransactionCount(
        personalSpaceVotingCloneFactory.address
      );
      const anticipatedPluginAddress = ethers.utils.getContractAddress({
        from: personalSpaceVotingCloneFactory.address,
        nonce,
      });
      await personalSpaceVotingCloneFactory.deployClone();
      personalSpaceVotingPlugin = PersonalSpaceVotingFactory.attach(
        anticipatedPluginAddress
      );
      // Should work
      await initializePSVPlugin();

      await expect(initializePSVPlugin()).to.be.revertedWith(
        'Initializable: contract is already initialized'
      );
    });
  });

  it('isMember() returns true when appropriate', async () => {
    expect(await personalSpaceVotingPlugin.isMember(ADDRESS_ZERO)).to.eq(false);
    expect(await personalSpaceVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);
    expect(await personalSpaceVotingPlugin.isMember(ADDRESS_TWO)).to.eq(false);

    expect(await personalSpaceVotingPlugin.isMember(alice.address)).to.eq(true);
    expect(await personalSpaceVotingPlugin.isMember(bob.address)).to.eq(true);
    expect(await personalSpaceVotingPlugin.isMember(carol.address)).to.eq(
      false
    );

    await dao.grant(
      personalSpaceVotingPlugin.address,
      carol.address,
      MEMBER_PERMISSION_ID
    );

    expect(await personalSpaceVotingPlugin.isMember(carol.address)).to.eq(true);
  });

  it('isEditor() returns true when appropriate', async () => {
    expect(await personalSpaceVotingPlugin.isEditor(ADDRESS_ZERO)).to.eq(false);
    expect(await personalSpaceVotingPlugin.isEditor(ADDRESS_ONE)).to.eq(false);
    expect(await personalSpaceVotingPlugin.isEditor(ADDRESS_TWO)).to.eq(false);

    expect(await personalSpaceVotingPlugin.isEditor(alice.address)).to.eq(true);
    expect(await personalSpaceVotingPlugin.isEditor(bob.address)).to.eq(false);
    expect(await personalSpaceVotingPlugin.isEditor(carol.address)).to.eq(
      false
    );

    await dao.grant(
      personalSpaceVotingPlugin.address,
      carol.address,
      EDITOR_PERMISSION_ID
    );

    expect(await personalSpaceVotingPlugin.isEditor(carol.address)).to.eq(true);
  });

  describe('Geo Browser customizations', () => {
    it('Only editors can create and execute arbitrary proposals', async () => {
      await expect(
        personalSpaceVotingPlugin
          .connect(bob)
          .executeProposal(dummyMetadata, dummyActions, 0)
      )
        .to.be.revertedWithCustomError(
          personalSpaceVotingPlugin,
          'DaoUnauthorized'
        )
        .withArgs(
          dao.address,
          personalSpaceVotingPlugin.address,
          bob.address,
          EDITOR_PERMISSION_ID
        );
      await expect(
        personalSpaceVotingPlugin
          .connect(carol)
          .executeProposal(dummyMetadata, dummyActions, 0)
      )
        .to.be.revertedWithCustomError(
          personalSpaceVotingPlugin,
          'DaoUnauthorized'
        )
        .withArgs(
          dao.address,
          personalSpaceVotingPlugin.address,
          carol.address,
          EDITOR_PERMISSION_ID
        );

      // Alice is an editor
      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, dummyActions, 0)
      ).to.emit(personalSpaceVotingPlugin, 'ProposalCreated');
    });

    it('Only members or editors can call content proposal wrappers', async () => {
      for (const account of [alice, bob]) {
        await expect(
          personalSpaceVotingPlugin
            .connect(account)
            .submitEdits('ipfs://', '0x', spacePlugin.address)
        ).to.not.be.reverted;
        await expect(
          personalSpaceVotingPlugin
            .connect(account)
            .submitFlagContent('ipfs://', spacePlugin.address)
        ).to.not.be.reverted;
        await expect(
          personalSpaceVotingPlugin
            .connect(account)
            .submitAcceptSubspace(ADDRESS_THREE, spacePlugin.address)
        ).to.not.be.reverted;
        await expect(
          personalSpaceVotingPlugin
            .connect(account)
            .submitRemoveSubspace(ADDRESS_THREE, spacePlugin.address)
        ).to.not.be.reverted;
        await expect(
          personalSpaceVotingPlugin
            .connect(account)
            .submitSetPayer(ADDRESS_THREE, spacePlugin.address)
        ).to.not.be.reverted;
      }
      expect(await personalSpaceVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(10)
      );

      // Non members
      await expect(
        personalSpaceVotingPlugin
          .connect(carol)
          .submitEdits('ipfs://', '0x', spacePlugin.address)
      )
        .to.be.revertedWithCustomError(personalSpaceVotingPlugin, 'NotAMember')
        .withArgs(carol.address);
      await expect(
        personalSpaceVotingPlugin
          .connect(carol)
          .submitFlagContent('ipfs://', spacePlugin.address)
      )
        .to.be.revertedWithCustomError(personalSpaceVotingPlugin, 'NotAMember')
        .withArgs(carol.address);
      await expect(
        personalSpaceVotingPlugin
          .connect(carol)
          .submitAcceptSubspace(ADDRESS_TWO, spacePlugin.address)
      )
        .to.be.revertedWithCustomError(personalSpaceVotingPlugin, 'NotAMember')
        .withArgs(carol.address);
      await expect(
        personalSpaceVotingPlugin
          .connect(carol)
          .submitRemoveSubspace(ADDRESS_TWO, spacePlugin.address)
      )
        .to.be.revertedWithCustomError(personalSpaceVotingPlugin, 'NotAMember')
        .withArgs(carol.address);
      await expect(
        personalSpaceVotingPlugin
          .connect(carol)
          .submitSetPayer(ADDRESS_TWO, spacePlugin.address)
      )
        .to.be.revertedWithCustomError(personalSpaceVotingPlugin, 'NotAMember')
        .withArgs(carol.address);
    });

    it('Only editors can call permission proposal wrappers', async () => {
      await expect(personalSpaceVotingPlugin.submitNewMember(ADDRESS_ONE)).to
        .not.be.reverted;
      await expect(personalSpaceVotingPlugin.submitNewEditor(ADDRESS_TWO)).to
        .not.be.reverted;
      await expect(personalSpaceVotingPlugin.submitRemoveMember(ADDRESS_ONE)).to
        .not.be.reverted;
      await expect(personalSpaceVotingPlugin.submitRemoveEditor(ADDRESS_TWO)).to
        .not.be.reverted;

      expect(await personalSpaceVotingPlugin.proposalCount()).to.equal(
        BigNumber.from(4)
      );

      // Non editors
      await expect(
        personalSpaceVotingPlugin.connect(carol).submitNewMember(ADDRESS_ONE)
      )
        .to.be.revertedWithCustomError(
          personalSpaceVotingPlugin,
          'DaoUnauthorized'
        )
        .withArgs(
          dao.address,
          personalSpaceVotingPlugin.address,
          carol.address,
          EDITOR_PERMISSION_ID
        );

      await expect(
        personalSpaceVotingPlugin.connect(carol).submitNewEditor(ADDRESS_TWO)
      )
        .to.be.revertedWithCustomError(
          personalSpaceVotingPlugin,
          'DaoUnauthorized'
        )
        .withArgs(
          dao.address,
          personalSpaceVotingPlugin.address,
          carol.address,
          EDITOR_PERMISSION_ID
        );

      await expect(
        personalSpaceVotingPlugin.connect(carol).submitRemoveMember(ADDRESS_ONE)
      )
        .to.be.revertedWithCustomError(
          personalSpaceVotingPlugin,
          'DaoUnauthorized'
        )
        .withArgs(
          dao.address,
          personalSpaceVotingPlugin.address,
          carol.address,
          EDITOR_PERMISSION_ID
        );

      await expect(
        personalSpaceVotingPlugin.connect(carol).submitRemoveEditor(ADDRESS_TWO)
      )
        .to.be.revertedWithCustomError(
          personalSpaceVotingPlugin,
          'DaoUnauthorized'
        )
        .withArgs(
          dao.address,
          personalSpaceVotingPlugin.address,
          carol.address,
          EDITOR_PERMISSION_ID
        );
    });

    it('Proposal execution is immediate', async () => {
      const data = SpacePlugin__factory.createInterface().encodeFunctionData(
        'publishEdits',
        ['ipfs://', '0x']
      );
      const actions = [
        {
          to: spacePlugin.address,
          value: 0,
          data,
        },
      ];
      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actions, 0)
      )
        .to.emit(spacePlugin, 'EditsPublished')
        .withArgs(dao.address, 'ipfs://', '0x');
    });

    it('Executed content proposals emit an event', async () => {
      // Encode an action to change some content
      const data = SpacePlugin__factory.createInterface().encodeFunctionData(
        'publishEdits',
        ['ipfs://', '0x']
      );
      const actions = [
        {
          to: spacePlugin.address,
          value: 0,
          data,
        },
      ];

      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actions, 0)
      ).to.emit(personalSpaceVotingPlugin, 'ProposalCreated');

      // ProposalExecuted is redundant and not emitted

      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actions, 0)
      )
        .to.emit(spacePlugin, 'EditsPublished')
        .withArgs(dao.address, 'ipfs://', '0x');
    });

    it('Approved subspaces emit an event', async () => {
      // Encode an action to accept a subspace
      const data = SpacePlugin__factory.createInterface().encodeFunctionData(
        'acceptSubspace',
        [ADDRESS_TWO]
      );
      const actions = [
        {
          to: spacePlugin.address,
          value: 0,
          data,
        },
      ];

      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actions, 0)
      ).to.emit(personalSpaceVotingPlugin, 'ProposalCreated');

      // ProposalExecuted is redundant and not emitted

      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actions, 0)
      )
        .to.emit(spacePlugin, 'SubspaceAccepted')
        .withArgs(dao.address, ADDRESS_TWO);
    });

    it('Removed subspaces emit an event', async () => {
      // Encode an action to accept a subspace
      const actionsAccept = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'acceptSubspace',
            [ADDRESS_TWO]
          ),
        },
      ];
      const actionsRemove = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'removeSubspace',
            [ADDRESS_TWO]
          ),
        },
      ];

      await personalSpaceVotingPlugin
        .connect(alice)
        .executeProposal(dummyMetadata, actionsAccept, 0);

      // remove
      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actionsRemove, 0)
      ).to.emit(personalSpaceVotingPlugin, 'ProposalCreated');

      // ProposalExecuted is redundant and not emitted

      await expect(
        personalSpaceVotingPlugin
          .connect(alice)
          .executeProposal(dummyMetadata, actionsRemove, 0)
      )
        .to.emit(spacePlugin, 'SubspaceRemoved')
        .withArgs(dao.address, ADDRESS_TWO);
    });
  });

  describe('Tests replicated from AdminPlugin', () => {
    describe('plugin interface: ', async () => {
      it('does not support the empty interface', async () => {
        expect(await personalSpaceVotingPlugin.supportsInterface('0xffffffff'))
          .to.be.false;
      });

      it('supports the `IERC165Upgradeable` interface', async () => {
        const iface = IERC165Upgradeable__factory.createInterface();
        expect(
          await personalSpaceVotingPlugin.supportsInterface(
            getInterfaceID(iface)
          )
        ).to.be.true;
      });

      it('supports the `IPlugin` interface', async () => {
        const iface = IPlugin__factory.createInterface();
        expect(
          await personalSpaceVotingPlugin.supportsInterface(
            getInterfaceID(iface)
          )
        ).to.be.true;
      });

      it('supports the `IProposal` interface', async () => {
        const iface = IProposal__factory.createInterface();
        expect(
          await personalSpaceVotingPlugin.supportsInterface(
            getInterfaceID(iface)
          )
        ).to.be.true;
      });
    });

    describe('execute proposal: ', async () => {
      it("fails to call DAO's `execute()` if `EXECUTE_PERMISSION` is not granted to the plugin address", async () => {
        await dao.revoke(
          dao.address,
          personalSpaceVotingPlugin.address,
          EXECUTE_PERMISSION_ID
        );

        await expect(
          personalSpaceVotingPlugin.executeProposal(
            dummyMetadata,
            dummyActions,
            0
          )
        )
          .to.be.revertedWithCustomError(dao, 'Unauthorized')
          .withArgs(
            dao.address,
            personalSpaceVotingPlugin.address,
            EXECUTE_PERMISSION_ID
          );
      });

      it('fails to call `executeProposal()` if `EDITOR_PERMISSION_ID` is not granted for the admin address', async () => {
        await dao.revoke(
          personalSpaceVotingPlugin.address,
          alice.address,
          EDITOR_PERMISSION_ID
        );

        await expect(
          personalSpaceVotingPlugin.executeProposal(
            dummyMetadata,
            dummyActions,
            0
          )
        )
          .to.be.revertedWithCustomError(
            personalSpaceVotingPlugin,
            'DaoUnauthorized'
          )
          .withArgs(
            dao.address,
            personalSpaceVotingPlugin.address,
            alice.address,
            EDITOR_PERMISSION_ID
          );
      });

      it('correctly emits the ProposalCreated event', async () => {
        const currentExpectedProposalId = 0;

        const allowFailureMap = 1;

        const tx = await personalSpaceVotingPlugin.executeProposal(
          dummyMetadata,
          dummyActions,
          allowFailureMap
        );

        await expect(tx).to.emit(personalSpaceVotingPlugin, 'ProposalCreated');

        const event = await findEvent<ProposalCreatedEvent>(
          tx,
          'ProposalCreated'
        );

        expect(event).to.be.ok;
        expect(event!.args.proposalId).to.equal(currentExpectedProposalId);
        expect(event!.args.creator).to.equal(alice.address);
        expect(event!.args.metadata).to.equal(dummyMetadata);
        expect(event!.args.actions.length).to.equal(1);
        expect(event!.args.actions[0].to).to.equal(dummyActions[0].to);
        expect(event!.args.actions[0].value).to.equal(dummyActions[0].value);
        expect(event!.args.actions[0].data).to.equal(dummyActions[0].data);
        expect(event!.args.allowFailureMap).to.equal(allowFailureMap);
      });

      it('correctly increments the proposal ID', async () => {
        const currentExpectedProposalId = 0;

        await personalSpaceVotingPlugin.executeProposal(
          dummyMetadata,
          dummyActions,
          0
        );

        const nextExpectedProposalId = currentExpectedProposalId + 1;

        const tx = await personalSpaceVotingPlugin.executeProposal(
          dummyMetadata,
          dummyActions,
          0
        );

        await expect(tx).to.emit(personalSpaceVotingPlugin, 'ProposalCreated');

        const event = await findEvent<ProposalCreatedEvent>(
          tx,
          'ProposalCreated'
        );

        expect(event).to.be.ok;
        expect(event!.args.proposalId).to.equal(nextExpectedProposalId);
      });

      it("calls the DAO's execute function correctly with proposalId", async () => {
        {
          const proposalId = 0;
          const allowFailureMap = 1;

          const tx = await personalSpaceVotingPlugin.executeProposal(
            dummyMetadata,
            dummyActions,
            allowFailureMap
          );

          const event = await findEventTopicLog<ExecutedEvent>(
            tx,
            DAO__factory.createInterface(),
            'Executed'
          );

          expect(event.args.actor).to.equal(personalSpaceVotingPlugin.address);
          expect(event.args.callId).to.equal(toBytes32(proposalId));
          expect(event.args.actions.length).to.equal(1);
          expect(event.args.actions[0].to).to.equal(dummyActions[0].to);
          expect(event.args.actions[0].value).to.equal(dummyActions[0].value);
          expect(event.args.actions[0].data).to.equal(dummyActions[0].data);
          // note that failureMap is different than allowFailureMap. See DAO.sol for details
          expect(event.args.failureMap).to.equal(0);
        }

        {
          const proposalId = 1;

          const tx = await personalSpaceVotingPlugin.executeProposal(
            dummyMetadata,
            dummyActions,
            0
          );

          const event = await findEventTopicLog<ExecutedEvent>(
            tx,
            DAO__factory.createInterface(),
            'Executed'
          );
          expect(event.args.callId).to.equal(toBytes32(proposalId));
        }
      });
    });
  });
});

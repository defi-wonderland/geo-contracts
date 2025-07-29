import {
  DAO,
  IDAO,
  SpacePlugin,
  SpacePlugin__factory,
  TestArbSys__factory,
} from '../../typechain';
import {deployWithProxy} from '../../utils/helpers';
import {deployTestDao} from '../helpers/test-dao';
import {
  ADDRESS_ONE,
  ADDRESS_TWO,
  ADDRESS_THREE,
  ADDRESS_ZERO,
  CONTENT_PERMISSION_ID,
  EXECUTE_PERMISSION_ID,
  SUBSPACE_PERMISSION_ID,
  PAYER_PERMISSION_ID,
  ZERO_BYTES32,
} from './common';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {ethers, network} from 'hardhat';

export type InitData = {contentUri: string; metadata: string};
export const defaultInitData: InitData = {
  contentUri: 'ipfs://',
  metadata: '0x',
};

describe('Space Plugin', function () {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dao: DAO;
  let spacePlugin: SpacePlugin;
  let defaultInput: InitData;

  const arbSysAddress: string = '0x0000000000000000000000000000000000000064';
  const txId: BigNumber = ethers.BigNumber.from(
    '43648854190046191863104915490136973604631114438068862776475182666495385665664'
  );

  before(async () => {
    [alice, bob, carol] = await ethers.getSigners();
    dao = await deployTestDao(alice);

    defaultInput = {contentUri: 'ipfs://', metadata: '0x'};
  });

  beforeEach(async () => {
    await network.provider.send('hardhat_setCode', [
      arbSysAddress,
      TestArbSys__factory.bytecode,
    ]);

    spacePlugin = await deployWithProxy<SpacePlugin>(
      new SpacePlugin__factory(alice)
    );

    await spacePlugin.initialize(
      dao.address,
      ADDRESS_THREE,
      defaultInput.contentUri,
      defaultInput.metadata,
      ADDRESS_ZERO
    );
  });

  describe('constants', async () => {
    it('Should set the ARB_SYS to address(100)', async () => {
      expect(await spacePlugin.ARB_SYS()).to.eq(arbSysAddress);
    });
  });

  describe('initialize', async () => {
    it('The Space plugin reverts if trying to re-initialize', async () => {
      await expect(
        spacePlugin.initialize(
          dao.address,
          ADDRESS_THREE,
          defaultInput.contentUri,
          defaultInput.metadata,
          ADDRESS_ZERO
        )
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('The Space plugin reverts if trying to set an invalid address', async () => {
      spacePlugin = await deployWithProxy<SpacePlugin>(
        new SpacePlugin__factory(alice)
      );

      await expect(
        spacePlugin.initialize(
          dao.address,
          ADDRESS_ZERO,
          defaultInput.contentUri,
          defaultInput.metadata,
          ADDRESS_ZERO
        )
      ).to.be.revertedWithCustomError(spacePlugin, 'InvalidAddress');
    });

    it('Should set the DAO and the PaymentManager', async () => {
      spacePlugin = await deployWithProxy<SpacePlugin>(
        new SpacePlugin__factory(alice)
      );

      await spacePlugin.initialize(
        dao.address,
        ADDRESS_THREE,
        defaultInput.contentUri,
        defaultInput.metadata,
        ADDRESS_ZERO
      );

      expect(await spacePlugin.dao()).to.eq(dao.address);
      expect(await spacePlugin.paymentManager()).to.eq(ADDRESS_THREE);
    });

    it('Should emit a new content event', async () => {
      spacePlugin = await deployWithProxy<SpacePlugin>(
        new SpacePlugin__factory(alice)
      );

      await expect(
        spacePlugin.initialize(
          dao.address,
          ADDRESS_THREE,
          defaultInput.contentUri,
          defaultInput.metadata,
          ADDRESS_ZERO
        )
      )
        .to.emit(spacePlugin, 'EditsPublished')
        .withArgs(dao.address, defaultInput.contentUri, defaultInput.metadata);
    });

    it('Should emit a successor space event', async () => {
      // 1
      spacePlugin = await deployWithProxy<SpacePlugin>(
        new SpacePlugin__factory(alice)
      );

      await expect(
        spacePlugin.initialize(
          dao.address,
          ADDRESS_THREE,
          defaultInput.contentUri,
          defaultInput.metadata,
          ADDRESS_ONE
        )
      )
        .to.emit(spacePlugin, 'SuccessorSpaceCreated')
        .withArgs(dao.address, ADDRESS_ONE);

      // 2
      spacePlugin = await deployWithProxy<SpacePlugin>(
        new SpacePlugin__factory(alice)
      );

      await expect(
        spacePlugin.initialize(
          dao.address,
          ADDRESS_THREE,
          defaultInput.contentUri,
          defaultInput.metadata,
          ADDRESS_TWO
        )
      )
        .to.emit(spacePlugin, 'SuccessorSpaceCreated')
        .withArgs(dao.address, ADDRESS_TWO);
    });
  });

  it('The Space plugin emits an event when new edits are published', async () => {
    // Fails by default
    await expect(spacePlugin.connect(alice).publishEdits('hello', '0x1234'))
      .to.be.revertedWithCustomError(spacePlugin, 'DaoUnauthorized')
      .withArgs(
        dao.address,
        spacePlugin.address,
        alice.address,
        CONTENT_PERMISSION_ID
      );

    // Grant
    await dao.grant(spacePlugin.address, alice.address, CONTENT_PERMISSION_ID);

    // Set content
    await expect(spacePlugin.connect(alice).publishEdits('hello', '0x1234'))
      .to.emit(spacePlugin, 'EditsPublished')
      .withArgs(dao.address, 'hello', '0x1234');
  });

  it('The Space plugin emits an event when the content is flagged', async () => {
    // Fails by default
    await expect(spacePlugin.connect(alice).flagContent('hello'))
      .to.be.revertedWithCustomError(spacePlugin, 'DaoUnauthorized')
      .withArgs(
        dao.address,
        spacePlugin.address,
        alice.address,
        CONTENT_PERMISSION_ID
      );

    // Grant
    await dao.grant(spacePlugin.address, alice.address, CONTENT_PERMISSION_ID);

    // Set content
    await expect(spacePlugin.connect(alice).flagContent('hello'))
      .to.emit(spacePlugin, 'ContentFlagged')
      .withArgs(dao.address, 'hello');
  });

  it('The Space plugin emits an event when a subspace is accepted', async () => {
    // Fails by default
    await expect(spacePlugin.connect(alice).acceptSubspace(ADDRESS_TWO))
      .to.be.revertedWithCustomError(spacePlugin, 'DaoUnauthorized')
      .withArgs(
        dao.address,
        spacePlugin.address,
        alice.address,
        SUBSPACE_PERMISSION_ID
      );

    // Grant
    await dao.grant(spacePlugin.address, alice.address, SUBSPACE_PERMISSION_ID);

    // Set content
    await expect(spacePlugin.connect(alice).acceptSubspace(ADDRESS_TWO))
      .to.emit(spacePlugin, 'SubspaceAccepted')
      .withArgs(dao.address, ADDRESS_TWO);
  });

  it('The Space plugin emits an event when a subspace is removed', async () => {
    // Fails by default
    await expect(spacePlugin.connect(alice).removeSubspace(ADDRESS_TWO))
      .to.be.revertedWithCustomError(spacePlugin, 'DaoUnauthorized')
      .withArgs(
        dao.address,
        spacePlugin.address,
        alice.address,
        SUBSPACE_PERMISSION_ID
      );

    // Grant
    await dao.grant(spacePlugin.address, alice.address, SUBSPACE_PERMISSION_ID);

    // Set content
    await expect(spacePlugin.connect(alice).removeSubspace(ADDRESS_TWO))
      .to.emit(spacePlugin, 'SubspaceRemoved')
      .withArgs(dao.address, ADDRESS_TWO);
  });

  it('The Space plugin emits an event when a payer is set', async () => {
    // Fails by default
    await expect(spacePlugin.connect(alice).setPayer(ADDRESS_TWO))
      .to.be.revertedWithCustomError(spacePlugin, 'DaoUnauthorized')
      .withArgs(
        dao.address,
        spacePlugin.address,
        alice.address,
        PAYER_PERMISSION_ID
      );

    // Grant
    await dao.grant(spacePlugin.address, alice.address, PAYER_PERMISSION_ID);

    // Set content
    await expect(spacePlugin.connect(alice).setPayer(ADDRESS_TWO))
      .to.emit(spacePlugin, 'PayerSet')
      .withArgs(dao.address, ADDRESS_TWO, txId);
  });

  describe('Permissions', () => {
    beforeEach(async () => {
      await dao
        .grant(dao.address, alice.address, EXECUTE_PERMISSION_ID)
        .then(tx => tx.wait());

      await dao
        .grant(spacePlugin.address, dao.address, CONTENT_PERMISSION_ID)
        .then(tx => tx.wait());

      await dao
        .grant(spacePlugin.address, dao.address, SUBSPACE_PERMISSION_ID)
        .then(tx => tx.wait());

      await dao
        .grant(spacePlugin.address, dao.address, PAYER_PERMISSION_ID)
        .then(tx => tx.wait());
    });

    it('Only the DAO can emit new contents on the space plugin', async () => {
      // They cannot
      await expect(spacePlugin.connect(alice).publishEdits('hello', '0x1234'))
        .to.be.reverted;
      await expect(spacePlugin.connect(bob).publishEdits('hello', '0x1234')).to
        .be.reverted;
      await expect(spacePlugin.connect(carol).publishEdits('hello', '0x1234'))
        .to.be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'publishEdits',
            ['hello', '0x1234']
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0))
        .to.emit(spacePlugin, 'EditsPublished')
        .withArgs(dao.address, 'hello', '0x1234');
    });

    it('Only the DAO can flag content on the space plugin', async () => {
      // They cannot
      await expect(spacePlugin.connect(alice).flagContent('0x1234')).to.be
        .reverted;
      await expect(spacePlugin.connect(bob).flagContent('0x1234')).to.be
        .reverted;
      await expect(spacePlugin.connect(carol).flagContent('0x1234')).to.be
        .reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'flagContent',
            ['0x1234']
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0))
        .to.emit(spacePlugin, 'ContentFlagged')
        .withArgs(dao.address, '0x1234');
    });

    it('Only the DAO can accept subspaces', async () => {
      // They cannot
      await expect(spacePlugin.connect(alice).acceptSubspace(ADDRESS_ONE)).to.be
        .reverted;
      await expect(spacePlugin.connect(bob).acceptSubspace(ADDRESS_ONE)).to.be
        .reverted;
      await expect(spacePlugin.connect(carol).acceptSubspace(ADDRESS_ONE)).to.be
        .reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'acceptSubspace',
            [ADDRESS_ONE]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0))
        .to.emit(spacePlugin, 'SubspaceAccepted')
        .withArgs(dao.address, ADDRESS_ONE);
    });

    it('Only the DAO can remove subspaces', async () => {
      // They cannot
      await expect(spacePlugin.connect(alice).removeSubspace(ADDRESS_ONE)).to.be
        .reverted;
      await expect(spacePlugin.connect(bob).removeSubspace(ADDRESS_ONE)).to.be
        .reverted;
      await expect(spacePlugin.connect(carol).removeSubspace(ADDRESS_ONE)).to.be
        .reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'removeSubspace',
            [ADDRESS_ONE]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0))
        .to.emit(spacePlugin, 'SubspaceRemoved')
        .withArgs(dao.address, ADDRESS_ONE);
    });

    it('Only the DAO can set the payer', async () => {
      // They cannot
      await expect(spacePlugin.connect(alice).setPayer(ADDRESS_ONE)).to.be
        .reverted;
      await expect(spacePlugin.connect(bob).setPayer(ADDRESS_ONE)).to.be
        .reverted;
      await expect(spacePlugin.connect(carol).setPayer(ADDRESS_ONE)).to.be
        .reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: spacePlugin.address,
          value: 0,
          data: SpacePlugin__factory.createInterface().encodeFunctionData(
            'setPayer',
            [ADDRESS_ONE]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0))
        .to.emit(spacePlugin, 'PayerSet')
        .withArgs(dao.address, ADDRESS_ONE, txId);
    });
  });
});

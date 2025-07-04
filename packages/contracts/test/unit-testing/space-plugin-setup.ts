import {
  DAO,
  SpacePlugin__factory,
  SpacePluginSetup,
  SpacePluginSetup__factory,
} from '../../typechain';
import {getPluginSetupProcessorAddress} from '../../utils/helpers';
import {deployTestDao} from '../helpers/test-dao';
import {Operation} from '../helpers/types';
import {
  ADDRESS_ONE,
  ADDRESS_ZERO,
  CONTENT_PERMISSION_ID,
  EXECUTE_PERMISSION_ID,
  NO_CONDITION,
  SUBSPACE_PERMISSION_ID,
} from './common';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {ethers, network} from 'hardhat';

describe('Space Plugin Setup', function () {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let spacePluginSetup: SpacePluginSetup;
  let SpacePluginSetup: SpacePluginSetup__factory;
  let dao: DAO;
  const defaultInitData = {contentUri: 'ipfs://', metadata: '0x'};

  before(async () => {
    [alice, bob] = await ethers.getSigners();
    dao = await deployTestDao(alice);

    const pspAddress = process.env.PLUGIN_SETUP_PROCESSOR_ADDRESS
      ? process.env.PLUGIN_SETUP_PROCESSOR_ADDRESS
      : getPluginSetupProcessorAddress(network.name, true);

    SpacePluginSetup = new SpacePluginSetup__factory(alice);
    spacePluginSetup = await SpacePluginSetup.deploy(pspAddress);
  });

  describe('prepareInstallation', async () => {
    it('returns the plugin, helpers, and permissions (no pluginUpgrader)', async () => {
      const initData = await spacePluginSetup.encodeInstallationParams(
        defaultInitData.contentUri,
        defaultInitData.metadata,
        ADDRESS_ZERO,
        ADDRESS_ZERO
      );

      const nonce = await ethers.provider.getTransactionCount(
        spacePluginSetup.address
      );
      const anticipatedPluginAddress = ethers.utils.getContractAddress({
        from: spacePluginSetup.address,
        nonce,
      });

      const {
        plugin,
        preparedSetupData: {helpers, permissions},
      } = await spacePluginSetup.callStatic.prepareInstallation(
        dao.address,
        initData
      );

      expect(plugin).to.be.equal(anticipatedPluginAddress);
      expect(helpers.length).to.be.equal(0);
      expect(permissions.length).to.be.equal(2);
      expect(permissions).to.deep.equal([
        [
          Operation.Grant,
          plugin,
          dao.address,
          NO_CONDITION,
          CONTENT_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          dao.address,
          NO_CONDITION,
          SUBSPACE_PERMISSION_ID,
        ],
      ]);

      await spacePluginSetup.prepareInstallation(dao.address, initData);
      const myPlugin = new SpacePlugin__factory(alice).attach(plugin);

      // initialization is correct
      expect(await myPlugin.dao()).to.eq(dao.address);
    });

    it('returns the plugin, helpers, and permissions (with a pluginUpgrader)', async () => {
      const pluginUpgrader = bob.address;
      const initData = await spacePluginSetup.encodeInstallationParams(
        defaultInitData.contentUri,
        defaultInitData.metadata,
        ADDRESS_ZERO,
        pluginUpgrader
      );
      const nonce = await ethers.provider.getTransactionCount(
        spacePluginSetup.address
      );
      const anticipatedPluginAddress = ethers.utils.getContractAddress({
        from: spacePluginSetup.address,
        nonce,
      });
      const anticipatedConditionAddress = ethers.utils.getContractAddress({
        from: spacePluginSetup.address,
        nonce: nonce + 1,
      });

      const {
        plugin,
        preparedSetupData: {helpers, permissions},
      } = await spacePluginSetup.callStatic.prepareInstallation(
        dao.address,
        initData
      );

      expect(plugin).to.be.equal(anticipatedPluginAddress);
      expect(helpers.length).to.be.equal(0);
      expect(permissions.length).to.be.equal(3);
      expect(permissions).to.deep.equal([
        [
          Operation.Grant,
          plugin,
          dao.address,
          NO_CONDITION,
          CONTENT_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          dao.address,
          NO_CONDITION,
          SUBSPACE_PERMISSION_ID,
        ],
        [
          Operation.GrantWithCondition,
          dao.address,
          pluginUpgrader,
          anticipatedConditionAddress,
          EXECUTE_PERMISSION_ID,
        ],
      ]);

      await spacePluginSetup.prepareInstallation(dao.address, initData);
      const myPlugin = new SpacePlugin__factory(alice).attach(plugin);

      // initialization is correct
      expect(await myPlugin.dao()).to.eq(dao.address);
    });
  });

  describe('prepareUninstallation', async () => {
    it('returns the permission changes (no pluginUpgrader)', async () => {
      const plugin = await new SpacePlugin__factory(alice).deploy();

      const uninstallData = await spacePluginSetup.encodeUninstallationParams(
        ADDRESS_ZERO
      );

      const permissions =
        await spacePluginSetup.callStatic.prepareUninstallation(dao.address, {
          plugin: plugin.address,
          currentHelpers: [],
          data: uninstallData,
        });

      expect(permissions.length).to.be.equal(2);
      expect(permissions).to.deep.equal([
        [
          Operation.Revoke,
          plugin.address,
          dao.address,
          NO_CONDITION,
          CONTENT_PERMISSION_ID,
        ],
        [
          Operation.Revoke,
          plugin.address,
          dao.address,
          NO_CONDITION,
          SUBSPACE_PERMISSION_ID,
        ],
      ]);
    });

    it('returns the permission changes (with a pluginUpgrader)', async () => {
      const plugin = await new SpacePlugin__factory(alice).deploy();

      const pluginUpgrader = bob.address;
      const uninstallData = await spacePluginSetup.encodeUninstallationParams(
        pluginUpgrader
      );

      const permissions =
        await spacePluginSetup.callStatic.prepareUninstallation(dao.address, {
          plugin: plugin.address,
          currentHelpers: [],
          data: uninstallData,
        });

      expect(permissions.length).to.be.equal(3);
      expect(permissions).to.deep.equal([
        [
          Operation.Revoke,
          plugin.address,
          dao.address,
          NO_CONDITION,
          CONTENT_PERMISSION_ID,
        ],
        [
          Operation.Revoke,
          plugin.address,
          dao.address,
          NO_CONDITION,
          SUBSPACE_PERMISSION_ID,
        ],
        [
          Operation.Revoke,
          dao.address,
          pluginUpgrader,
          NO_CONDITION,
          EXECUTE_PERMISSION_ID,
        ],
      ]);
    });
  });
});

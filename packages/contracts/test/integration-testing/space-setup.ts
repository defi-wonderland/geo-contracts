import {SpacePluginSetupParams} from '../../plugin-setup-params';
import {
  PluginRepo,
  SpacePlugin,
  SpacePlugin__factory,
  SpacePluginSetup,
  SpacePluginSetup__factory,
} from '../../typechain';
import {PluginSetupRefStruct} from '../../typechain/@aragon/osx/framework/dao/DAOFactory';
import {getPluginSetupProcessorAddress} from '../../utils/helpers';
import {getPluginRepoInfo} from '../../utils/plugin-repo-info';
import {installPlugin, uninstallPlugin} from '../helpers/setup';
import {deployTestDao} from '../helpers/test-dao';
import {ADDRESS_ZERO} from '../unit-testing/common';
import {
  DAO,
  PluginRepo__factory,
  PluginSetupProcessor,
  PluginSetupProcessor__factory,
} from '@aragon/osx-ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {ethers, network} from 'hardhat';

describe('SpacePluginSetup processing', function () {
  let deployer: SignerWithAddress;

  let psp: PluginSetupProcessor;
  let dao: DAO;
  let pluginRepo: PluginRepo;

  before(async () => {
    [deployer] = await ethers.getSigners();

    const pluginRepoInfo = getPluginRepoInfo(
      SpacePluginSetupParams.PLUGIN_REPO_ENS_NAME,
      network.name
    );
    if (!pluginRepoInfo) {
      throw new Error('The plugin setup details are not available');
    }

    // PSP
    const pspAddress = process.env.PLUGIN_SETUP_PROCESSOR_ADDRESS
      ? process.env.PLUGIN_SETUP_PROCESSOR_ADDRESS
      : getPluginSetupProcessorAddress(network.name, true);

    psp = PluginSetupProcessor__factory.connect(pspAddress, deployer);

    // Deploy DAO.
    dao = await deployTestDao(deployer);

    await dao.grant(
      dao.address,
      psp.address,
      ethers.utils.id('ROOT_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_INSTALLATION_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_UNINSTALLATION_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_UPDATE_PERMISSION')
    );

    pluginRepo = PluginRepo__factory.connect(pluginRepoInfo.address, deployer);
  });

  context('Build 1', async () => {
    let setup: SpacePluginSetup;
    let pluginSetupRef: PluginSetupRefStruct;
    let plugin: SpacePlugin;
    const pluginUpgrader = ADDRESS_ZERO;

    before(async () => {
      const release = 1;

      // Deploy setups.
      setup = SpacePluginSetup__factory.connect(
        (await pluginRepo['getLatestVersion(uint8)'](release)).pluginSetup,
        deployer
      );

      pluginSetupRef = {
        versionTag: {
          release: BigNumber.from(release),
          build: BigNumber.from(1),
        },
        pluginSetupRepo: pluginRepo.address,
      };
    });

    beforeEach(async () => {
      // Install build 1.
      const data = await setup.encodeInstallationParams(
        'ipfs://',
        '0x',
        ADDRESS_ZERO,
        pluginUpgrader
      );
      const results = await installPlugin(psp, dao, pluginSetupRef, data);

      plugin = SpacePlugin__factory.connect(
        results.preparedEvent.args.plugin,
        deployer
      );
    });

    it('installs & uninstalls', async () => {
      expect(await plugin.implementation()).to.be.eq(
        await setup.implementation()
      );
      expect(await plugin.dao()).to.be.eq(dao.address);

      // Uninstall build 1.
      const data = await setup.encodeUninstallationParams(pluginUpgrader);
      await uninstallPlugin(psp, dao, plugin, pluginSetupRef, data, []);
    });
  });
});

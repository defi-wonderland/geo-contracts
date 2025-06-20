import {PersonalSpaceAdminPluginSetupParams} from '../../plugin-setup-params';
import {
  PersonalSpaceAdminPlugin,
  PersonalSpaceAdminPlugin__factory,
  PersonalSpaceAdminPluginSetup,
  PersonalSpaceAdminPluginSetup__factory,
  PluginRepo,
} from '../../typechain';
import {PluginSetupRefStruct} from '../../typechain/@aragon/osx/framework/dao/DAOFactory';
import {getPluginSetupProcessorAddress} from '../../utils/helpers';
import {getPluginRepoInfo} from '../../utils/plugin-repo-info';
import {installPlugin, uninstallPlugin} from '../helpers/setup';
import {deployTestDao} from '../helpers/test-dao';
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

describe('PersonalSpaceAdmin processing', function () {
  let alice: SignerWithAddress;

  let psp: PluginSetupProcessor;
  let dao: DAO;
  let pluginRepo: PluginRepo;

  before(async () => {
    [alice] = await ethers.getSigners();

    const pluginRepoInfo = getPluginRepoInfo(
      PersonalSpaceAdminPluginSetupParams.PLUGIN_REPO_ENS_NAME,
      network.name
    );
    if (!pluginRepoInfo) {
      throw new Error('The plugin setup details are not available');
    }

    // PSP
    const pspAddress = process.env.PLUGIN_SETUP_PROCESSOR_ADDRESS
      ? process.env.PLUGIN_SETUP_PROCESSOR_ADDRESS
      : getPluginSetupProcessorAddress(network.name, true);

    psp = PluginSetupProcessor__factory.connect(pspAddress, alice);

    // Deploy DAO.
    dao = await deployTestDao(alice);

    await dao.grant(
      dao.address,
      psp.address,
      ethers.utils.id('ROOT_PERMISSION')
    );
    await dao.grant(
      psp.address,
      alice.address,
      ethers.utils.id('APPLY_INSTALLATION_PERMISSION')
    );
    await dao.grant(
      psp.address,
      alice.address,
      ethers.utils.id('APPLY_UNINSTALLATION_PERMISSION')
    );
    await dao.grant(
      psp.address,
      alice.address,
      ethers.utils.id('APPLY_UPDATE_PERMISSION')
    );

    pluginRepo = PluginRepo__factory.connect(pluginRepoInfo.address, alice);
  });

  context('Build 1', async () => {
    let setup: PersonalSpaceAdminPluginSetup;
    let pluginSetupRef: PluginSetupRefStruct;
    let plugin: PersonalSpaceAdminPlugin;

    before(async () => {
      const release = 1;

      // Deploy setup.
      setup = PersonalSpaceAdminPluginSetup__factory.connect(
        (await pluginRepo['getLatestVersion(uint8)'](release)).pluginSetup,
        alice
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
      const initialEditor = alice.address;

      // Install build 1.
      const data = await setup.encodeInstallationParams(initialEditor);
      const results = await installPlugin(psp, dao, pluginSetupRef, data);

      plugin = PersonalSpaceAdminPlugin__factory.connect(
        results.preparedEvent.args.plugin,
        alice
      );
    });

    it('installs & uninstalls', async () => {
      expect(await plugin.dao()).to.be.eq(dao.address);

      // Uninstall build 1.
      const data = '0x'; // no parameters
      await uninstallPlugin(psp, dao, plugin, pluginSetupRef, data, []);
    });
  });
});

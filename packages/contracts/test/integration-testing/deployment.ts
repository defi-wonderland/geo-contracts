import {
  GovernancePluginsSetupParams,
  PersonalSpaceAdminPluginSetupParams,
  SpacePluginSetupParams,
} from '../../plugin-setup-params';
import {PluginRepo} from '../../typechain';
import {getPluginRepoRegistryAddress} from '../../utils/helpers';
import {getPluginRepoInfo} from '../../utils/plugin-repo-info';
import {PluginRepoRegistry__factory} from '@aragon/osx-ethers';
import {PluginRepoRegistry} from '@aragon/osx-ethers';
import {PluginRepo__factory} from '@aragon/osx-ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {deployments, ethers, network} from 'hardhat';

async function deployAll() {
  await deployments.fixture();
}

describe('PluginRepo Deployment', function () {
  let alice: SignerWithAddress;
  let repoRegistry: PluginRepoRegistry;
  let pluginRepo: PluginRepo;

  before(async () => {
    [alice] = await ethers.getSigners();

    // Deployment should be empty
    expect(await deployments.all()).to.be.empty;

    // Deploy all contracts
    await deployAll();
  });

  const setups = [
    GovernancePluginsSetupParams,
    PersonalSpaceAdminPluginSetupParams,
    SpacePluginSetupParams,
  ];

  setups.forEach(pluginSetupParams => {
    context(pluginSetupParams.PLUGIN_CONTRACT_NAME, () => {
      before(() => {
        // plugin repo registry
        const repoRegistryAddr: string = process.env
          .PLUGIN_REPO_REGISTRY_ADDRESS
          ? process.env.PLUGIN_REPO_REGISTRY_ADDRESS
          : getPluginRepoRegistryAddress(network.name);

        repoRegistry = PluginRepoRegistry__factory.connect(
          repoRegistryAddr,
          alice
        );

        const pluginRepoInfo = getPluginRepoInfo(
          pluginSetupParams.PLUGIN_REPO_ENS_NAME,
          network.name
        );
        if (!pluginRepoInfo) {
          throw new Error(
            `${pluginSetupParams.PLUGIN_CONTRACT_NAME}: Cannot find the deployment entry`
          );
        }
        pluginRepo = PluginRepo__factory.connect(pluginRepoInfo.address, alice);
      });

      it('creates the repo', async () => {
        expect(await repoRegistry.entries(pluginRepo.address)).to.be.true;
      });

      it('makes the deployer the repo maintainer', async () => {
        expect(
          await pluginRepo.isGranted(
            pluginRepo.address,
            alice.address,
            ethers.utils.id('ROOT_PERMISSION'),
            ethers.constants.AddressZero
          )
        ).to.be.true;

        expect(
          await pluginRepo.isGranted(
            pluginRepo.address,
            alice.address,
            ethers.utils.id('UPGRADE_REPO_PERMISSION'),
            ethers.constants.AddressZero
          )
        ).to.be.true;
      });

      context('Publication', () => {
        it('registerd the setup', async () => {
          const results = await pluginRepo['getVersion((uint8,uint16))'](
            pluginSetupParams.VERSION
          );

          expect(results.pluginSetup).to.equal(
            (
              await deployments.get(
                pluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME
              )
            ).address
          );

          const receivedStrMetadata = Buffer.from(
            results.buildMetadata.slice(2),
            'hex'
          ).toString();
          expect(receivedStrMetadata).to.equal('\0');
        });
      });
    });
  });
});

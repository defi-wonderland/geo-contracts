import {NetworkNameMapping, NetworkBlockNumberMapping} from './utils/helpers';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-etherscan';
import '@openzeppelin/hardhat-upgrades';
import '@typechain/hardhat';
import {config as dotenvConfig} from 'dotenv';
import 'hardhat-deploy';
import 'hardhat-gas-reporter';
import 'hardhat-tracer';
import {extendEnvironment, HardhatUserConfig} from 'hardhat/config';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import type {NetworkUserConfig} from 'hardhat/types';
import {resolve} from 'path';
import 'solidity-coverage';

const dotenvConfigPath: string = process.env.DOTENV_CONFIG_PATH || '../../.env';
dotenvConfig({path: resolve(__dirname, dotenvConfigPath)});

const apiUrls: NetworkNameMapping = {
  mainnet: 'https://eth-mainnet.g.alchemy.com/v2/',
  sepolia: 'https://eth-sepolia.g.alchemy.com/v2/',
  polygon: 'https://polygon-mainnet.g.alchemy.com/v2/',
  conduit: process.env.DEPLOYMENT_RPC_ENDPOINT ?? '',
};

const blockNumbers: NetworkBlockNumberMapping = {
  mainnet: 21900000,
  sepolia: 7777777,
  polygon: 68000000,
  conduit: 500,
};

export const networks: {[index: string]: NetworkUserConfig} = {
  hardhat: {
    chainId: 31337,
    forking: {
      url: apiUrls.conduit,
      blockNumber:
        blockNumbers[
          process.env.NETWORK_NAME ? process.env.NETWORK_NAME : 'conduit'
        ],
    },
  },
  conduit: {
    chainId: 80451,
    url: apiUrls.conduit,
  },
  mainnet: {
    chainId: 1,
    url: `${apiUrls.mainnet}${process.env.ALCHEMY_API_KEY}`,
  },
  sepolia: {
    chainId: 11155111,
    url: `${apiUrls.sepolia}${process.env.ALCHEMY_API_KEY}`,
  },
  polygon: {
    chainId: 137,
    url: `${apiUrls.polygon}${process.env.ALCHEMY_API_KEY}`,
  },
  custom: {
    chainId: 19411,
    url: apiUrls.conduit,
    // gasPrice: 20000000000,
  },
};

// Uses hardhats private key if none is set. DON'T USE THIS ACCOUNT FOR DEPLOYMENTS
const accounts = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY.split(',')
  : // Test PK
    ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'];

for (const network in networks) {
  // special treatement for hardhat
  if (network.startsWith('hardhat')) {
    networks[network].accounts = {
      mnemonic: 'test test test test test test test test test test test junk',
    };
    continue;
  }
  networks[network].accounts = accounts;
}

// Extend HardhatRuntimeEnvironment
extendEnvironment((hre: HardhatRuntimeEnvironment) => {
  (hre as any).aragonToVerifyContracts = [];
  (hre as any).managingDao = {
    address: '',
    governancePlugin: '',
  };
});

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'baseGoerli',
        chainId: 84531,
        urls: {
          apiURL: 'https://api-goerli.basescan.org/api',
          browserURL: 'https://goerli.basescan.org',
        },
      },
      {
        network: 'conduit',
        chainId: networks.conduit.chainId!,
        urls: {
          apiURL: apiUrls.conduit,
          browserURL: '',
        },
      },
      {
        network: 'custom',
        chainId: networks.custom.chainId!,
        urls: {
          apiURL: apiUrls.conduit,
          browserURL: '',
        },
      },
    ],
  },
  mocha: {
    timeout: 90 * 1000,
  },

  namedAccounts: {
    deployer: 0,
    alice: 0,
    bob: 1,
    carol: 2,
    dave: 3,
    eve: 4,
    frank: 5,
    grace: 6,
    harold: 7,
    ivan: 8,
    judy: 9,
    mallory: 10,
  },

  gasReporter: {
    currency: 'USD',
    enabled: process.env.REPORT_GAS === 'true' ? true : false,
    excludeContracts: [],
    src: './contracts',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  networks,
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    sources: './src',
    tests: './test',
    deploy: './deploy',
  },

  solidity: {
    version: '0.8.17',
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/hardhat-template/issues/31
        bytecodeHash: 'none',
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 800,
      },
    },
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

export default config;

This is a test project to test the Cosmos batch transaction. 

Based on `ethers.js v6` and `evmosjs`.

## Setup
```
yarn install
copy .env.example .env
```

Edit the `.env` file. Please note `COSMOS_RPC_URL` should be the Cosmos REST API.

## Patch the dependencies

There is a bug in dependencies
```
node_modules/@evmos/proto/dist/proto/evmos/vesting/tx.js
```

This line
```
export * from '@buf/evmos_evmos.bufbuild_es/evmos/vesting/v1/tx_pb.js';
```

should be changed to

```
export * from '@buf/evmos_evmos.bufbuild_es/evmos/vesting/v1/tx_pb.js';
```

## Execute
```
ts-node-esm src/test-batch.ts
```

Please note this is an ES Module project (required by `evmosjs`), so you need `ts-node-esm` instead of `ts-node`.

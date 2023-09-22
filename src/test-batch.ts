import { ethers, parseUnits, Transaction } from "ethers";
import { Message } from '@bufbuild/protobuf'
import * as proto from '@evmos/proto'
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    const provider = ethers.getDefaultProvider(process.env.EVM_RPC_URL!);
    const signer0 = new ethers.Wallet(process.env.PRIVATE_KEY_0!, provider);
    const signer1 = new ethers.Wallet(process.env.PRIVATE_KEY_1!, provider);

    const signer0Nonce = await signer0.getNonce();
    const signer1Nonce = await signer1.getNonce();

    // clone txnTemplate to txn0
    let network = await provider.getNetwork();
    const txn0 = {
        type: 1,
        to: signer0.address,
        value: 1,
        gasLimit: 21000,
        gasPrice: parseUnits("4800", "gwei"),
        nonce: signer0Nonce,
        chainId: network.chainId,
    };

    const txn1 = {
        type: 1,
        to: signer1.address,
        value: 1,
        gasLimit: 21000,
        gasPrice: parseUnits("10000", "gwei"),
        nonce: signer1Nonce,
        chainId: network.chainId,
    };

    console.log(txn0)
    console.log(txn1)

    const signedTxn0 = await signer0.signTransaction(txn0);
    const signedTxn1 = await signer1.signTransaction(txn1);
    console.log(signedTxn0)
    console.log(signedTxn1)

    // send txn0 to the mempool
    const transactionResponse = await provider.broadcastTransaction(signedTxn0);
    transactionResponse.wait(1).then(async (receipt) => {
        console.log(`Got receipt, confirmations: ${await receipt?.confirmations()}, blockNumber: ${receipt?.blockNumber}`)
    });

    const parsedTxn0 = Transaction.from(signedTxn0); // ethers v6 has bug to parse the signature v value, it's 27 greater than the actual value
    const parsedTxn1 = Transaction.from(signedTxn1);
    console.log(parsedTxn0.signature!.v)
    console.log(parsedTxn1.signature!.v)

    // console.log(JSON.stringify(evmTxToCosmosTx(parsedTxn0), null, 2))
    // console.log(JSON.stringify(evmTxToCosmosTx(parsedTxn1), null, 2))

    const cosmosTx = wrapEvmTxnsIntoCosmosTxn([parsedTxn0, parsedTxn1]);
    const base64CosmosTx = Buffer.from(cosmosTx.toBinary()).toString('base64');

    console.log(base64CosmosTx)

    const response = await fetch(process.env.COSMOS_RPC_URL!, {
        method: "POST",
        headers: {'Content-Type': 'application/json',},
        body: JSON.stringify({
            tx_bytes: base64CosmosTx,
            mode: "BROADCAST_MODE_BLOCK"
        })
    });

    if (response.ok) {
        console.log(await response.json())
    } else {
        console.log("request error", await response.json());
    }
}

function wrapEvmTxnsIntoCosmosTxn(evmTxns: ethers.Transaction[]): proto.Proto.Cosmos.Transactions.Tx.Tx {
    const msgEthereumTxs = evmTxns.map(evmTxn => {
        const legacyTx = new proto.Proto.Ethermint.EVM.Tx.AccessListTx({
            chainId: evmTxn.chainId.toString(),
            accesses: [],
            nonce: BigInt(evmTxn.nonce),
            gasPrice: evmTxn.gasPrice!.toString(),
            gas: evmTxn.gasLimit,
            to: evmTxn.to!,
            value: evmTxn.value.toString(),
            data: hexToUint8Array(evmTxn.data),
            v: numToUint8Array(evmTxn.signature!.v - 27), // fix the v value
            r: hexToUint8Array(evmTxn.signature!.r),
            s: hexToUint8Array(evmTxn.signature!.s),
        });
        const anyLegacyTx = proto.createAnyMessage(toMessageGenerated(legacyTx))
        return new proto.Proto.Ethermint.EVM.Tx.MsgEthereumTx({
            data: anyLegacyTx,
            size: 0,
            hash: evmTxn.hash!,
            from: ""
        });
    });

    const txBody = proto.createBodyWithMultipleMessages(msgEthereumTxs.map(toMessageGenerated), "");

    const extensionOptionsEthereumTx = new proto.Proto.Ethermint.EVM.Tx.ExtensionOptionsEthereumTx();

    const anyExtensionOptionsEthereumTx = proto.createAnyMessage(toMessageGenerated(extensionOptionsEthereumTx));

    txBody.extensionOptions = [anyExtensionOptionsEthereumTx];

    const totalGasFee = evmTxns.reduce((acc, evmTxn) => acc + (evmTxn.gasLimit * evmTxn.gasPrice!), 0n);
    const totalGasLimit = evmTxns.reduce((acc, evmTxn) => acc + evmTxn.gasLimit, 0n);

    const fee = proto.createFee(totalGasFee.toString(), "basecro", Number(totalGasLimit));

    const authInfo = new proto.Proto.Cosmos.Transactions.Tx.AuthInfo({
        signerInfos: [],
        fee
    });

    return new proto.Proto.Cosmos.Transactions.Tx.Tx({
        body: txBody,
        authInfo,
        signatures: []
    });
}

function toMessageGenerated(msg: Message): proto.MessageGenerated {
    return {
        message: msg,
        path: msg.getType().typeName
    }
}

function hexToUint8Array(hex: string) {
    const buffer = Buffer.from(hex.replace('0x', ''), 'hex');
    return new Uint8Array(buffer);
}

function numToUint8Array(num: number) {
    let hex = num.toString(16);
    if (hex.length % 2 == 1) {
        hex = '0' + hex
    }
    return hexToUint8Array(hex);
}

function evmTxToCosmosTxJson(evmTx: ethers.Transaction) {
    return {
        "body": {
            "messages": [
                {
                    "@type": "/ethermint.evm.v1.MsgEthereumTx",
                    "data": {
                        "@type": "/ethermint.evm.v1.LegacyTx",
                        "nonce": evmTx.nonce.toString(),
                        "gas_price": evmTx.gasPrice!.toString(),
                        "gas": evmTx.gasLimit.toString(),
                        "to": evmTx.to,
                        "value": "0",
                        "data": hexToBase64(evmTx.data),
                        "v": numToBase64(evmTx.signature!.v),
                        "r": hexToBase64(evmTx.signature!.r),
                        "s": hexToBase64(evmTx.signature!.s)
                    },
                    "size": 0,
                    "hash": evmTx.hash,
                    "from": ""
                }
            ],
            "memo": "",
            "timeout_height": "0",
            "extension_options": [
                {
                    "@type": "/ethermint.evm.v1.ExtensionOptionsEthereumTx"
                }
            ],
            "non_critical_extension_options": []
        },
        "auth_info": {
            "signer_infos": [],
            "fee": {
                "amount": [
                    {
                        "denom": "basecro",
                        "amount": (evmTx.gasLimit * evmTx.gasPrice!).toString()
                    }
                ],
                "gas_limit": evmTx.gasLimit.toString(),
                "payer": "",
                "granter": ""
            },
            "tip": null
        },
        "signatures": []
    }
}

function hexToBase64(hex: string) {
    return Buffer.from(hex.replace('0x', ''), 'hex').toString('base64');
}

function numToBase64(num: number) {
    return Buffer.from(num.toString(16), 'hex').toString('base64');
}


main().catch(console.error)
import createBrowserless from 'browserless';
import getHTML from 'html-get';
import fs from 'fs';
import Bundlr from '@bundlr-network/client';
import { WarpFactory } from 'warp-contracts';
import Arweave from 'arweave';
import { selectTokenHolder } from './utils/selectTokenHolder.js';

const jwk = JSON.parse(fs.readFileSync("wallet.json").toString());
const URL = 'https://gateway.redstone.finance/gateway/contracts/deploy'
const arweave = Arweave.init({
    host: 'arweave.net',
    port: '443',
    protocol: 'https'
})

const browserlessFactory = createBrowserless();

const getContent = async (url) => {
    // create a browser context inside Chromium process
    const browserContext = browserlessFactory.createContext()
    const getBrowserless = () => browserContext
    const result = await getHTML(url, { getBrowserless })
    // close the browser context after it's used
    const res = await createTxn(result)
    console.log(`https://arweave.net/${res}`)
    process.exit()
}

const createTxn = async (result) => {
    const tx = await arweave.createTransaction({
        data: result.html
    }, jwk)
    tx.addTag('Content-Type', 'text/html');
    await arweave.transactions.sign(tx, jwk)
    const assetId = tx.id
    await arweave.transactions.post(tx)
    const res = await createAtomicAsset(assetId, 'web-page', 'text/html');
    return res
}

async function createAtomicAsset(assetId, assetType, contentType) {
    try {
        const dataAndTags = await createDataAndTags(assetId, assetType, contentType)
        const atomicId = await dispatchToBundler(dataAndTags)
        await deployToWarp(atomicId, dataAndTags)
        return atomicId
    } catch (e) {
        return Promise.reject('Could not create Atomic Transaction')
    }
}

async function dispatchToBundler({ data, tags }) {
    let bundlr = await new Bundlr.default("https://node2.bundlr.network", "arweave", jwk);
    try {
        const tx = bundlr.createTransaction(data, { tags: tags })
        await tx.sign(jwk)
        const id = tx.id
        await tx.upload()
        return id
    } catch (err) {
        console.error(err)
    }
}

async function deployToWarp(atomicId, { data, tags }) {
    try {
        const tx = await arweave.createTransaction({ data })
        await tags.map(t => tx.addTag(t.name, t.value))

        await arweave.transactions.sign(tx, jwk)
        tx.id = atomicId

        const result = await fetch(URL, {
            method: 'POST',
            body: JSON.stringify({ contractTx: tx }),
            headers: {
                'Accept-Encoding': 'gzip, deflate, br',
                'Content-Type': 'application/json',
                Accept: 'application/json'
            }
        })
        // console.log("ATOMIC ID", tx.id)
        return { id: atomicId }
    } catch (err) {
        console.error(err)
    }
}

async function createDataAndTags(assetId, assetType, contentType) {
    try {
        const warp = WarpFactory.forMainnet();
        const contract = warp.contract("t6AAwEvvR-dbp_1FrSfJQsruLraJCobKl9qsJh9yb2M").connect(jwk);

        const { cachedValue } = await contract.setEvaluationOptions({
            internalWrites: true,
            allowUnsafeClient: true,
            allowBigInt: true
        }).readState()

        const state = cachedValue.state
        const randomContributor = selectTokenHolder(state.tokens, state.totalSupply)
        return {
            data: JSON.stringify({
                manifest: "arweave/paths",
                version: "0.1.0",
                index: { path: "index.html" },
                paths: { "index.html": { id: assetId } }
            }),
            tags: [
                { name: 'App-Name', value: 'SmartWeaveContract' },
                { name: 'App-Version', value: '0.3.0' },
                { name: 'Content-Type', value: "application/x.arweave-manifest+json" },
                { name: 'Contract-Src', value: "eLUFzkrDnqXRdmBZtSgz1Bgy8nKC8ED3DoC__PaBJj8" },
                { name: 'Pool-Id', value: "CCobTPEONmH0OaQvGYt47sIif-9F78Y2r1weg3X2owc" },
                // { name: 'Pool-Id', value: "CCobTPEONmH0OaQvGYt47sIif-9F78Y2r1weg3X2owc" },
                { name: 'Artefact-Name', value: `TEST - ${assetId}` },
                { name: 'Created-At', value: Date.now().toString() },
                { name: 'Type', value: assetType },
                {
                    name: 'Init-State', value: JSON.stringify({
                        ticker: "ATOMIC-ASSET-" + assetId,
                        balances: {
                            [randomContributor]: 1
                        },
                        contentType: contentType,
                        description: `DEPLOY TEST 1`,
                        lastTransferTimestamp: null,
                        lockTime: 0,
                        maxSupply: 1,
                        name: "DEPLOY", // CHANGE THIS
                        title: "DEPLOY", // CHANGE THIS
                        transferable: true
                    })
                }
            ]
        }
    } catch (err) {
        console.error(err)
    }
}

getContent(process.argv[2])

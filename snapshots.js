#!/usr/bin/env node
const R = require('ramda');
const Alpaca = require("@alpacahq/alpaca-trade-api");
const dotenv = require('dotenv');
const fs = require('fs').promises;
const argv = require('yargs').argv;
const {getSymbols} = require('./utils');
const logger = require('./logger');


// eslint-disable-next-line no-undef
const {parsed: cfg} = dotenv.config({path: `${__dirname}/.env`});    


const printUsage = () => {
    console.log('Usage:');
    console.log('./snapshots.js --symbols AAPL,TSLA --symbolsFile sp500.txt');
}

const downloadAndSaveChunk = async (chunk, alpaca) => {
    try {
        const snapshots = await downloadSnapshot(chunk, alpaca);        
        await Promise.allSettled (snapshots.map(saveToFile));
    } catch (err) {        
        logger.error(err);
    }
}

const saveToFile = async (snapshot) => {
    logger.info(`Writing file '${snapshot.symbol}.json'`);
    const data = {};
    data[snapshot.symbol] = snapshot.data;
    await fs.writeFile(`${snapshot.symbol}.json`, JSON.stringify(data, null, 2));    
}

const transformSnapshot = s => {
    const bar = s.DailyBar;
    return {symbol: s.symbol, data: [{'DateTime': bar.Timestamp, 'Open': bar.OpenPrice, 'High': bar.HighPrice, 'Low': bar.LowPrice, 'Close': bar.ClosePrice, 'Volume': bar.Volume}]};
};

const downloadSnapshot = async (symbols, alpaca) => {
    logger.info(`Downloading snapshot for ${symbols.length} symbols`);
    const snapshots = await alpaca.getSnapshots(symbols);
    return snapshots.map(transformSnapshot);
};

(async () => {
    if (!(argv.symbols || argv.symbolsFile)) {
        printUsage();
        return 0;
    }

    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
    });
    const concurrentSymbols = parseInt(cfg['CONCURRENT_SYMBOLS']) || 100;
    const symbols = await getSymbols(argv.symbols, argv.symbolsFile);	
    R.pipe(
        R.splitEvery(concurrentSymbols),
        R.map(chunk => downloadAndSaveChunk(chunk, alpaca))
    )(symbols);    
    
})();

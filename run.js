#!/usr/bin/env node

const Alpaca = require('@alpacahq/alpaca-trade-api')
const dotenv = require('dotenv');
const fs = require('fs').promises;
const argv = require('yargs').argv;
const _ = require('lodash');
const logger = require('./logger');



const printUsage = () => {
    console.log("Usage:");
    console.log("./run.js --symbols SPY,QQQ --symbolsFile sp500.txt --interval 1Min|5Min|15Min|Day --limit 1000");
}


const download = async (symbols, alpaca, limit = 1000) => {
    try {
        logger.info(`Getting data for ${symbols.length} symbols`);
        logger.debug(symbols);
        const data = await alpaca.getBars(argv.interval, symbols, {limit});
        
        const res = Promise.all(symbols.map(async (symbol) => {
            if (!data[symbol]) {
                logger.warn(`Skipping '${symbol}'`);
                return Promise.resolve();
            }
            const d = {};
            d[symbol] = data[symbol];
            logger.info(`Writing ${data[symbol].length} bars ${symbol}.json`);
            await fs.writeFile(`${symbol}.json`, JSON.stringify(d, null, 2));
        }));
    } catch(err) {
        logger.error(err);
    }
}

const getSymbols = async (symbolsList, symbolsFile) => {    
    if (symbolsList) {
        let symbols = symbolsList.split(',');
        return symbols;
    } else {
        logger.info(`Reading symbols from file ${symbolsFile}`);
        const data = await fs.readFile(symbolsFile);
        return data.toString().split('\n').filter(s => (!(s === '' || s.includes('/') || s.startsWith('#'))));        
    }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const main = async () => {
    if (!(argv.symbols || argv.symbolsFile) || !argv.interval) {
        printUsage();
        process.exit(1)
    }
    const {parsed: cfg} = dotenv.config({path: `${__dirname}/.env`});    
    logger.info(`Using config config ${JSON.stringify(cfg)}`); 
    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
      });
    const symbols = await getSymbols(argv.symbols, argv.symbolsFile);
    _.chunk(symbols, 100).map(async (chunk) => {        
        await download(chunk, alpaca, argv.limit);
    });
};

main();

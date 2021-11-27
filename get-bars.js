#!/usr/bin/env node
const R = require('ramda');
const Alpaca = require("@alpacahq/alpaca-trade-api");
const dotenv = require('dotenv');
const argv = require('yargs').argv;
const fs = require('fs').promises;
const logger = require('./logger');
const { getSymbols } = require('./utils');

// eslint-disable-next-line no-undef
const {parsed: cfg} = dotenv.config({path: `${__dirname}/.env`});    

const printUsage = () => {
    console.log('Usage:');
    console.log('./get-bars.js --start <2021-01-01> --timeframe <1min|15min|60min|day> --limit <1...10000> --symbols AAPL,TSLA --symbolsFile sp500.txt');
}

const getDateTimeSubtractMinutes = (minutes) => {
    const date = new Date();
    // TODO: subract minutes;
    return date.toISOString();
};

const getDateTimeSubtractDays = (days) => {
    const date = new Date();
    // TODO: subract days;
    //return date.toISOString();
    return '2021-11-01T04:00:00.00Z'; // midnight EST
};

const transformBarData = (barData) => {
    return {
        'DateTime': barData.Timestamp,
        'Open': barData.OpenPrice,
        'High': barData.HighPrice,
        'Low': barData.LowPrice,
        'Close': barData.ClosePrice,
        'Volume': barData.Volume,        
    }
}

// Returns JSON object with symbol and array with OHLC data: { symbol: "AAPL", bars: [ {"Open": .., "High": .., "Low": .., "Close": .., "Volume": ..}]}
const getBars = async (symbol, alpaca, {start, end, timeframe, limit}) => {
    const bars = []
    const data = {
        symbol,
        bars
    }
    try {
        
        let res = alpaca.getBarsV2(
            symbol,
            {
                start,
                end,
                limit,
                timeframe,
                adjustment: 'all'
            },
          );
        for await (let b of res){
            bars.push(transformBarData(b));                        
        }        
    } catch (error) {
        console.log(`${symbol}: ${error}`);
    } 
    return data;
};

const saveToFile = async (barsForSymbol) => {    
    // Write JSON object with symbol and array with OHLCV data:
    // { "AAPL": [ 
    //  {"Open": .., "High": .., "Low": .., "Close": .., "Volume": ..},
    //  {"Open": .., "High": .., "Low": .., "Close": .., "Volume": ..},
    //  {"Open": .., "High": .., "Low": .., "Close": .., "Volume": ..}
    // ]}
    const data = {};    
    data[barsForSymbol.symbol] = barsForSymbol.bars; 
    const str = JSON.stringify(data, null, 2);
    await fs.writeFile(`${barsForSymbol.symbol}.json`, str);
    logger.info(`Wrote file (${Math.round(str.length / 1024, 0)}kb) '${barsForSymbol.symbol}.json'`);
}

const downloadAndSaveChunk = async (symbols, alpaca, options) => {
    try {
        const res = await Promise.all(symbols.map(symbol => getBars(symbol, alpaca, options)));        
        await Promise.allSettled (res.map(saveToFile));
    } catch (err) {        
        logger.error(err);
    }
}

(async () => {
    // if (!(argv.symbols || argv.symbolsFile || argv.start || argv.timeframe)) {
    //     printUsage();
    //     return 0;
    // }

    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
      });

    // Premarket: 
    //const start = '2021-11-23T05:20:00-05:00';
    //const end = '2021-11-23T05:36:00-05:00';
    // After open: first 2bars:
    //const start = '2021-11-23T09:00:00-05:00';
    //const end = '2021-11-24T09:29:59-05:00';
    //const end = '2021-11-24T23:59:59-05:00';
    // Daily bars after open:
    const start = '2021-11-23';
    //const end = '2021-11-26';
    const end = new Date().toISOString();
    const limit = 500;
    const timeframe = '15Min';
	const symbols = [ 'AAPL', 'TSLA'];
    //const symbols = await getSymbols(argv.symbols, argv.symbolsFile);	
    const options = {
        start,
        end,
        timeframe,
        limit
    }
    R.pipe(
        R.splitEvery(100),
        R.map(chunk => downloadAndSaveChunk(chunk, alpaca, options))
    )(symbols);
})();

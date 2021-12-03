#!/usr/bin/env node
const R = require('ramda');
const Alpaca = require("@alpacahq/alpaca-trade-api");
const dotenv = require('dotenv');
const argv = require('yargs').argv;
const fs = require('fs').promises;
const logger = require('./logger');
const { getSymbols } = require('./utils');

const VALID_TIMEFRAMES = ['1min', '15min', '60min', 'day'];
const TIMEFRAME_MAPPING = {
    '1min': '1Min',
    '15min': '15Min',
    '60min': '1Hour',
    'day': '1Day'
}

// eslint-disable-next-line no-undef
const {parsed: cfg} = dotenv.config({path: `${__dirname}/.env`});    

const printUsage = () => {
    console.log('Usage:');
    console.log('./get-bars.js --start <2021-01-01> --timeframe <1min|15min|60min|day> --limit <1...10000> --symbols AAPL,TSLA --symbolsFile sp500.txt');
}

const getDefaultStart = (timeframe) => {
    const epoch = new Date().getTime();
    if (timeframe === '1min') {
        return new Date(epoch - 24 * 60 * 60 * 1000); // 1 day
    }
    if (timeframe === '15min') {
        return new Date(epoch - 7 * 24 * 60 * 60 * 1000); // 1 week
    }
    if (timeframe === '60min') {
        return new Date(epoch - 30 * 24 * 60 * 60 * 1000); // 30 days
    }
    if (timeframe === 'day') {
        return new Date(epoch - 360 * 24 * 60 * 60 * 1000); // 1 year
    }
}

// Create a RFC3339 date string
const createRFC3339DateString = (date) => {
    // TODO: always return UTC (Zulu), so just remove 4 or 5 hours depending on DST/EST
    let str;
    if (date.length === 10) {
        str = `${date}T00:00:00Z`; 
    } else if (date.length === 16) {
        // TODO: substract hours
        str = `${date.substr(0, 10)}T${date.substr(11, 16)}:00Z`;
    } else {
        throw Error(`Invalid date format: '${date}'`);
    }
    return str;
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
const getBars = async (symbol, alpaca, {start, end, timeframe, limit, bulkDownload}) => {
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
        
        // TODO: 
        // if bulkDownload:
        //      while last bar timestamp < end:
        //          set start to last bar timestamp + 1min (if 1min timeframe) and call getBars again
        // NOTE: need to convert between UTC to compare to end??
    } catch (error) {        
        logger.error(`${symbol}: ${error}`); // 422 error likely due to erroneous start/end parameter
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
    if (barsForSymbol.bars.length === 0) {
        logger.info(`No data for '${barsForSymbol.symbol}'. Skipping.`);
    } else {
        const str = JSON.stringify(data, null, 2);
        await fs.writeFile(`${barsForSymbol.symbol}.json`, str);
        logger.info(`Wrote file (${Math.round(str.length / 1024, 0)}kb) '${barsForSymbol.symbol}.json'`);
    }    
}

const downloadAndSaveChunk = async (symbols, alpaca, options) => {
    try {
        const barsForSymbols = await Promise.all(symbols.map(symbol => getBars(symbol, alpaca, options)));        
        await Promise.allSettled (barsForSymbols.map(saveToFile));
        return barsForSymbols;
    } catch (err) {        
        logger.error(err);
    }
}

(async () => {
    if (!(argv.symbols || argv.symbolsFile)) {
        console.log('Missing --symbols parameter or --symbolsFile parameter')
        printUsage();
        return 0;
    }
    if (!(VALID_TIMEFRAMES.includes(argv.timeframe))) {
        console.log('Missing valid --timeframe parameter', 'Valid: ', VALID_TIMEFRAMES)
        printUsage();
        return 0;
    }
    
    let options;
    if (argv.start && argv.end) {
        options = {
            timeframe: TIMEFRAME_MAPPING[argv.timeframe],
            limit: 10000,
            start: createRFC3339DateString(argv.start),
            end: createRFC3339DateString(argv.end),
        }
    } else {
        // Options for non-bulk download
        options = {
            timeframe: TIMEFRAME_MAPPING[argv.timeframe],
            limit: 10000,
            start: getDefaultStart(argv.timeframe).toISOString(),
            end: new Date().toISOString(),
        };
    }

    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
      });

    const symbols = await getSymbols(argv.symbols, argv.symbolsFile);	
    R.pipe(
        R.splitEvery(100),
        R.map(chunk => downloadAndSaveChunk(chunk, alpaca, options))
    )(symbols);
})();

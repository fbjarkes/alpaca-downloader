const Alpaca = require('@alpacahq/alpaca-trade-api')
const dotenv = require('dotenv');
const fs = require('fs').promises;
const logger = require('./logger');

const argv = require('yargs').argv;

const printUsage = () => {
    console.log("Usage:");
    console.log("./run.js --symbols SPY,QQQ --symbolsFile sp500.txt --interval 1min|5min|15min|day");
}


const download = async (symbols, alpaca, limit = 1000) => {
    try {
        logger.debug(`Getting data for ${symbols.length} symbols`);
        const data = await alpaca.getBars(argv.interval, symbols, {limit});
        
        const res = Promise.all(symbols.map(async (symbol) => {
            if (!data[symbol]) {
                logger.warn(`Skipping '${symbol}'`);
                return Promise.resolve();
            }
            logger.info(`Writing ${data[symbol].length} lines ${symbol}.json`);
            await fs.writeFile(`${symbol}.json`, JSON.stringify(data[symbol], null, 2));
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
        return data.toString().split('\n').filter(s => s !== '');
    }
}

const main = async () => {
    if (!(argv.symbols || argv.symbolsFile) || !argv.interval) {
        printUsage();
        process.exit(1)
    }
    const {parsed: cfg} = dotenv.config();    
    logger.info(`Using config config ${JSON.stringify(cfg)}`); 
    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
      });
    const symbols = await getSymbols(argv.symbols, argv.symbolsFile);
    const res = await download(symbols, alpaca);
};

main();
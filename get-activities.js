const dotenv = require('dotenv');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const logger = require('./logger');
const argv = require('yargs')
  .option('verbose', {
    alias: 'v',
    describe: 'Enable verbose logging',
    type: 'boolean',
    default: false,
  })
  .argv;

if (argv.verbose) {
    logger.level = 'debug'
} else {
    logger.level = 'info'
}

// eslint-disable-next-line no-undef
const { parsed: cfg } = dotenv.config({ path: `${__dirname}/.env` });


const printUsage = () => {
    console.log('Usage:');
    console.log(
        './get-activities.js [-v] --date|--start|--end <YYYY-MM-DD>'
    );
};

class ClosedTrade {
    constructor(trade) {
      const { symbol, entryPrice, exitPrice, avgEntry, qty, pnl, entryDate, exitDate } = trade;
      this.symbol = symbol;
      this.entryPrice = entryPrice;
      this.exitPrice = exitPrice;
      this.avgEntry = avgEntry;
      this.qty = qty;
      this.pnl = pnl;
      this.entryDate = entryDate;
      this.exitDate = exitDate;
    }
}

class OpenTrade {
        
    qty = 0;
    totalQty = 0;    
    totalPnl = 0;
    firstEntryDate = null;
    lastEntryDate = null;
    avgCostPerUnit = 0;
    totalCost = 0;
    exitPrice = 0; // last entry price
    entryPrice= 0; // first entry price

    constructor(symbol) {
        this.symbol = symbol;
    }

    add(tradeActivity) {                        
        if (this.qty === 0) {
            this.firstEntryDate = tradeActivity.transactionTime;
            this.entryPrice = tradeActivity.price;
        }        
        this.qty += tradeActivity.qty;
        this.totalCost += (tradeActivity.qty * tradeActivity.price);
        this.totalQty += tradeActivity.qty;
        this.avgCostPerUnit = this.totalCost / this.totalQty;        
    }

    reduce(tradeActivity) {        
        const pnl = tradeActivity.qty * (tradeActivity.price - this.avgCostPerUnit);
        this.totalPnl += pnl;        
        this.qty -= tradeActivity.qty;        
        if (this.qty === 0) {
            this.lastEntryDate = tradeActivity.transactionTime;
            this.exitPrice = tradeActivity.price;
        }        
    }
}

class TradeActivity {
    constructor({
      id,
      activity_type,
      transaction_time,
      type,
      price,
      qty,
      side,
      symbol,
      leaves_qty,
      order_id,
      cum_qty,
      order_status,
    }) {
      this.id = id;
      this.activityType = activity_type;
      this.transactionTime = transaction_time;
      this.type = type;
      this.price = parseFloat(price);
      this.qty = parseInt(qty);
      this.side = side;
      this.symbol = symbol;
      this.leavesQty = parseInt(leaves_qty);
      this.orderId = order_id;
      this.cumQty = parseInt(cum_qty);
      this.orderStatus = order_status;
    }

  }


(async () => {
    
    const { date, start } = argv;
    const options = {
        activityTypes: 'FILL',
        pageToken: undefined,
        pageSize: 100,        
        date: date ? new Date(date) : undefined,
        after: start ? new Date(start) : undefined,
        //until: // TODO: filter trades after fetching all instead
    };
    if (!options.date && !options.after) {
        options.after = new Date();
        options.after.setDate(options.after.getDate() - 30);
    }
    
    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
    });
    
    const max_limit = 100_000; // TODO: needed?    
    const trades = [];
    const tradesBySymbol = {};
    const closedTrades = [];
    const openTrades = [];
    
    console.log(`Fetching activities with options: ${JSON.stringify(options)}`);
    try {        
        let activities = [];
        do {                                
            activities = await alpaca.getAccountActivities(options);
            logger.debug(`getAccount(${JSON.stringify(options)})`);
            for (let activity of activities) {
                const t = new TradeActivity(activity);
                trades.push(t);
                if (!tradesBySymbol[t.symbol]) {
                    tradesBySymbol[t.symbol] = [];
                }
                tradesBySymbol[t.symbol].push(t);
            }
            options.pageToken = activities?.[activities.length - 1]?.id || undefined;

        } while (trades.length < max_limit && options.pageToken);
        
        logger.debug("Trades:");        
        for (let trade of trades) {
            logger.debug(`[${trade.transactionTime}] ${trade.symbol}: ${trade.side} ${trade.qty} @ ${trade.price}`);            
        }
        
        Object.entries(tradesBySymbol).forEach(([symbol, trades]) => {         
            let openTrade = null;            
            const tradesReversed = [...trades].reverse();
            
            tradesReversed.forEach((tradeActivity) => {                
                if (openTrade) {
                    if (tradeActivity.side === 'buy') {
                        openTrade.add(tradeActivity);
                    }
                    if (tradeActivity.side === 'sell') {
                        openTrade.reduce(tradeActivity);
                    }
                    if (openTrade.qty === 0) {
                        const c = new ClosedTrade({entryDate: openTrade.firstEntryDate, exitDate: openTrade.lastEntryDate, 
                            symbol: symbol, qty: openTrade.totalQty, pnl: openTrade.totalPnl, 
                            avgEntry: openTrade.avgCostPerUnit, entryPrice: openTrade.entryPrice, exitPrice: openTrade.exitPrice});
                        logger.debug(`${symbol}: ClosedTrade: ${c.qty} @ ${c.entryPrice} -> ${c.exitPrice} = ${c.pnl}`);
                        closedTrades.push(c);
                        openTrade = null;
                    }
                } else {
                    if (tradeActivity.side === 'buy') {
                        openTrade = new OpenTrade(symbol);
                        openTrade.add(tradeActivity);
                    }
                    if (tradeActivity.side === 'sell') {
                        logger.debug(`${symbol}: ${tradeActivity.transactionTime} ${tradeActivity.side} ${tradeActivity.qty} @ ${tradeActivity.price} No buy to connect to. Skipping.`);
                        openTrades.push(tradeActivity);
                    }
                }
            });
        });
        
        // TODO: print in nicely formatted tabular form
        console.log(`Unhandled activities (${openTrades.length}):`);
        openTrades.forEach((openTrade) => {
            console.log(`[${openTrade.symbol}] ${openTrade.transactionTime}: ${openTrade.side} ${openTrade.qty} @ ${openTrade.price}`);
        });
        console.log(`Closed trades (${closedTrades.length}):`);
        let totalPnl = 0;
        closedTrades.forEach((closedTrade) => {
            console.log(`[${closedTrade.symbol}] ${closedTrade.entryDate}-${closedTrade.exitDate}:  ${closedTrade.qty} @ ${closedTrade.entryPrice} -> ${closedTrade.exitPrice} = ${closedTrade.pnl}`);
            totalPnl += closedTrade.pnl;
        });
        console.log("Total PnL: ", totalPnl);
             
    } catch (error) {
        logger.error(error); 
    }
    
})();
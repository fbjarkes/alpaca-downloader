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

const printUsage = () => {
    console.log('Usage:');
    console.log(
        './activites.js ...'
    );
};

class ClosedTrade {    
    constructor({
        symbol,
        entry_price, // avg entry price
        qty,
        pnl,
        entry_date, // first entry
        exit_date, // last entry
    }) {
        this.symbol = symbol;
        this.entryPrice = entry_price;
        this.qty = qty;
        this.pnl = pnl;
        this.entryDate = entry_date;
        this.exitDate = exit_date;
    }
}

class Trade {
    constructor({
        price,
        qty,
        datetime,
        type,
    }) {    
        this.price = price;
        this.qty = qty;
        this.datetime = datetime;
        this.type = type;
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

    constructor(symbol) {
        this.symbol = symbol;
    }

    add(tradeActivity) {                        
        if (this.qty === 0) {
            this.firstEntryDate = tradeActivity.transactionTime;
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
  
    // You can add methods or additional logic related to the Trade class here
  }


(async () => {
    
    
    let options;
    if (argv.start && argv.end) {
        options = {
            start: createRFC3339DateString(argv.start),
            end: createRFC3339DateString(argv.end)
        };
    } else if (argv.days) {
        options = {            
            start: new Date(new Date().getTime() - argv.days * 24 * 60 * 60 * 1000), // start 'days' ago
            end: new Date().toISOString() // end now
        };
    } else {
        options = {
            start: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days default
            end: new Date().toISOString()
        };
    }

    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
    });
    const activityTypes = 'FILL';
    const max_limit = 500;
    const pageSize = 100;
    const trades = [];
    const tradesBySymbol = {};
    const closedTrades = [];
    
    try {
        let pageToken = undefined; // TODO: pagination only when date is not specified?
        let activities = [];
        do {            
            activities = await alpaca.getAccountActivities({ activityTypes, pageSize, pageToken });
            logger.debug(`getAccount(${activityTypes}, ${pageSize}, ${pageToken}): ${activities.length} activities`);

            for (let activity of activities) {
                const t = new TradeActivity(activity);
                trades.push(t);
                if (!tradesBySymbol[t.symbol]) {
                    tradesBySymbol[t.symbol] = [];
                }
                tradesBySymbol[t.symbol].push(t);
            }
            pageToken = activities?.[activities.length - 1]?.id || undefined;

        } while (trades.length < max_limit && pageToken);
        
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
                        const c = new ClosedTrade({entry_date: openTrade.firstEntryDate, exit_date: openTrade.lastEntryDate, 
                            symbol: symbol, qty: openTrade.totalQty, pnl: openTrade.totalPnl, 
                            avgEntry: openTrade.avgCostPerUnit});
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
                    }
                }
            });
        });
        
        console.log("Closed Trades:");
        let totalPnl = 0;
        closedTrades.forEach((closedTrade) => {
            console.log(`[${closedTrade.symbol}] ${closedTrade.entryDate}-${closedTrade.exitDate}:  ${closedTrade.qty} @ ${closedTrade.entryPrice} -> ${closedTrade.exitPrice} = ${closedTrade.pnl}`);
            totalPnl += closedTrade.pnl;
        });
        console.log("Total PnL: ", totalPnl);
             
    } catch (error) {
        console.log(error);
        //logger.error(error); 
    }
    
})();
const dotenv = require('dotenv');
const argv = require('yargs').argv;
const Alpaca = require('@alpacahq/alpaca-trade-api');
const logger = require('./logger');
const { getSymbols, sleep } = require('./utils');



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


class Trade {
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
    
    try {
        let pageToken = undefined; // TODO: pagination only when date is not specified?
        let activities = [];
        do {            
            activities = await alpaca.getAccountActivities({ activityTypes, pageSize, pageToken });
            console.log(`getAccount(${activityTypes}, ${pageSize}, ${pageToken}): ${activities.length} activities`);

            for (let activity of activities) {
                trades.push(new Trade(activity));
            }
            pageToken = activities?.[activities.length - 1]?.id || undefined;

        } while (trades.length < max_limit && pageToken);
        
        console.log("Trades:");
        for (let trade of trades) {
            console.log(`[${trade.transactionTime}] ${trade.symbol}: ${trade.side} ${trade.qty} @ ${trade.price}`);
        }
                
    } catch (error) {
        console.log(error);
        //logger.error(error); 
    }
    
})();
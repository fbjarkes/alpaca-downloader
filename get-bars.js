const Alpaca = require("@alpacahq/alpaca-trade-api");
const dotenv = require('dotenv');
const {parsed: cfg} = dotenv.config({path: `${__dirname}/.env`});    


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
        'Timestamp': barData.Timestamp,
        'Open': barData.OpenPrice,
        'High': barData.HighPrice,
        'Low': barData.LowPrice,
        'Close': barData.ClosePrice,
        'Volume': barData.Volume,
        'TradeCount': barData.TradeCount,
        'VWAP': barData.VWAP
    }
}

const getBars = async (symbol, start, end, limit, timeframe, alpaca) => {
    try {
        const bars = [];
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
            bars.push(b);                        
        }
        return {
            symbol,
            bars
        }
    } catch (error) {
        console.log(`${symbol}: ${error}`);
    } 
    return {
        symbol,
        bars: []
    }
};

(async () => {
    const alpaca = new Alpaca({
        keyId: cfg['KEY_ID'],
        secretKey: cfg['SECRET_KEY'],
        paper: true,
        usePolygon: false
      });

	const symbols = [ 'AAPL'];
    const barDatas = await Promise.all(
		symbols.map((sym) => {
			return getBars(sym, '2021-11-12', '2021-11-18', 50, '1Day', alpaca);
		})
	);
    
    barDatas.filter(barData => barData.bars.length).forEach((barData) => {
		console.log(`${barData.symbol} (${barData.bars.length} bars):`);
		barData.bars.forEach(b => console.log(transformBarData(b).Timestamp));
    });	
})();
